import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import './SolutionChart.css'

type ChartPoint = { parameter: number; values: number[] | null; error?: string }

export interface SolutionChartProps {
  modelKind?: 'linear' | 'nonlinear'
  points: ChartPoint[]
  selectionPoints?: ChartPoint[]
  variables: string[]
  parameterName: string
  currentParameter: number
  currentValues?: number[]
  selectedIndex: number | null
  onSelectIndex: (index: number | null) => void
  visibleVariables: string[]
  onToggleVariable: (name: string) => void
}

export const SERIES_COLORS = [
  '#087f74',
  '#df9963',
  '#879ac3',
  '#b18aa7',
  '#c0a853',
  '#639ba9',
]

const MAX_WIDTH = 680
const MIN_WIDTH = 320
const HEIGHT = 290
const PLOT = { left: 51, right: 20, top: 24, bottom: 37 }
const INNER_HEIGHT = HEIGHT - PLOT.top - PLOT.bottom

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  const absolute = Math.abs(value)
  if (absolute >= 1e6 || absolute < 0.0001) return value.toExponential(2)
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(
    value,
  )
}

function axisNumber(value: number): string {
  if (value === 0) return '0'
  if (Math.abs(value) >= 1e5 || Math.abs(value) < 0.001)
    return value.toExponential(1)
  return Number(value.toPrecision(4)).toString()
}

// Normalize before subtraction so opposite large values cannot overflow a span.
function fraction(value: number, min: number, max: number): number {
  const scale = Math.max(Math.abs(min), Math.abs(max))
  if (!scale || min === max) return 0.5
  return (value / scale - min / scale) / (max / scale - min / scale)
}

function interpolate(min: number, max: number, ratio: number): number {
  return min * (1 - ratio) + max * ratio
}

function niceDomain(values: number[]): [number, number, number[]] {
  if (!values.length) return [0, 1, [0, 0.25, 0.5, 0.75, 1]]
  let min = Math.min(0, ...values)
  let max = Math.max(0, ...values)
  if (max === min) return [0, 1, [0, 0.25, 0.5, 0.75, 1]]
  const fallback = (): [number, number, number[]] => [
    min,
    max,
    [
      ...new Set(
        Array.from({ length: 5 }, (_, index) =>
          interpolate(min, max, index / 4),
        ),
      ),
    ],
  ]
  const rawStep = max / 4 - min / 4
  if (!Number.isFinite(rawStep) || rawStep <= 0) return fallback()
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  if (!Number.isFinite(magnitude) || magnitude === 0) return fallback()
  const factor = rawStep / magnitude
  const step =
    (factor <= 1
      ? 1
      : factor <= 2
        ? 2
        : factor <= 2.5
          ? 2.5
          : factor <= 5
            ? 5
            : 10) * magnitude
  if (!Number.isFinite(step) || step <= 0) return fallback()
  const roundedMin = Math.floor(min / step) * step
  const roundedMax = Math.ceil(max / step) * step
  if (Number.isFinite(roundedMin)) min = roundedMin
  if (Number.isFinite(roundedMax)) max = roundedMax
  const count = Math.round(max / step - min / step)
  if (!Number.isFinite(count) || count < 1 || count > 20) return fallback()
  const ticks = Array.from({ length: count + 1 }, (_, index) =>
    interpolate(min, max, index / count),
  )
  return [min, max, ticks]
}

export default function SolutionChart({
  modelKind = 'linear',
  points,
  selectionPoints,
  variables,
  parameterName,
  currentParameter,
  currentValues,
  selectedIndex,
  onSelectIndex,
  visibleVariables,
  onToggleVariable,
}: SolutionChartProps) {
  const titleId = useId()
  const descriptionId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(MAX_WIDTH)
  const innerWidth = width - PLOT.left - PLOT.right
  // Plot resolution is independent of the user-defined dataset interval.
  // Exploration uses dataset rows so graph and table share exact solve points.
  const interactivePoints = selectionPoints?.length ? selectionPoints : points

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const updateWidth = (measuredWidth: number) => {
      if (Number.isFinite(measuredWidth) && measuredWidth > 0) {
        setWidth(
          Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(measuredWidth))),
        )
      }
    }
    updateWidth(container.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) updateWidth(entries[0].contentRect.width)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const visible = variables
    .map((name, index) => ({ name, index }))
    .filter(({ name }) => visibleVariables.includes(name))
  const chart = useMemo(() => {
    const finitePoints = points.filter((point) =>
      Number.isFinite(point.parameter),
    )
    if (!finitePoints.length) return null
    let minX = Math.min(...finitePoints.map((point) => point.parameter))
    let maxX = Math.max(...finitePoints.map((point) => point.parameter))
    if (minX === maxX) {
      const padding = Math.abs(minX) * 0.1 || 0.5
      if (Number.isFinite(minX - padding)) minX -= padding
      if (Number.isFinite(maxX + padding)) maxX += padding
    }
    const values: number[] = []
    points.forEach((point) => {
      if (!Number.isFinite(point.parameter)) return
      variables.forEach((name, index) => {
        const value = point.values?.[index]
        if (
          visibleVariables.includes(name) &&
          typeof value === 'number' &&
          Number.isFinite(value)
        )
          values.push(value)
      })
    })
    currentValues?.forEach((value, index) => {
      if (visibleVariables.includes(variables[index]) && Number.isFinite(value))
        values.push(value)
    })
    const [minY, maxY, yTicks] = niceDomain(values)
    return { minX, maxX, minY, maxY, yTicks, hasData: values.length > 0 }
  }, [points, variables, visibleVariables, currentValues])

  const nearest = (value: number) => {
    if (!chart) return -1
    let nearestIndex = -1
    let distance = Infinity
    interactivePoints.forEach((point, index) => {
      const nextDistance = Math.abs(
        fraction(point.parameter, chart.minX, chart.maxX) -
          fraction(value, chart.minX, chart.maxX),
      )
      if (Number.isFinite(nextDistance) && nextDistance < distance) {
        distance = nextDistance
        nearestIndex = index
      }
    })
    return nearestIndex
  }

  const activeIndex =
    selectedIndex !== null &&
    selectedIndex >= 0 &&
    selectedIndex < interactivePoints.length
      ? selectedIndex
      : nearest(currentParameter)
  const activePoint = interactivePoints[activeIndex]
  const x = (value: number) =>
    PLOT.left + fraction(value, chart!.minX, chart!.maxX) * innerWidth
  const y = (value: number) =>
    PLOT.top +
    INNER_HEIGHT -
    fraction(value, chart!.minY, chart!.maxY) * INNER_HEIGHT
  const currentInDomain =
    chart &&
    Number.isFinite(currentParameter) &&
    currentParameter >= chart.minX &&
    currentParameter <= chart.maxX

  function handlePointer(event: PointerEvent<SVGSVGElement>) {
    if (!chart) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width) return
    const localX = ((event.clientX - rect.left) / rect.width) * width
    const ratio = Math.min(1, Math.max(0, (localX - PLOT.left) / innerWidth))
    const index = nearest(interpolate(chart.minX, chart.maxX, ratio))
    if (index >= 0) onSelectIndex(index)
  }

  function handleKey(event: KeyboardEvent<SVGSVGElement>) {
    if (!interactivePoints.length) return
    const current = activeIndex < 0 ? 0 : activeIndex
    let index = current
    if (event.key === 'ArrowLeft') index = Math.max(0, current - 1)
    else if (event.key === 'ArrowRight')
      index = Math.min(interactivePoints.length - 1, current + 1)
    else if (event.key === 'Home') index = 0
    else if (event.key === 'End') index = interactivePoints.length - 1
    else if (event.key === 'Escape') {
      onSelectIndex(null)
      return
    } else return
    event.preventDefault()
    onSelectIndex(index)
  }

  const buildPath = (variableIndex: number) => {
    let path = ''
    let connected = false
    points.forEach((point) => {
      const value = point.values?.[variableIndex]
      if (
        !Number.isFinite(point.parameter) ||
        typeof value !== 'number' ||
        !Number.isFinite(value)
      ) {
        connected = false
        return
      }
      path += `${connected ? 'L' : 'M'}${x(point.parameter).toFixed(3)},${y(value).toFixed(3)} `
      connected = true
    })
    return path
  }

  const emptyMessage = !points.length
    ? '모델을 계산하면 파라미터에 따른 해의 변화를 볼 수 있어요.'
    : !visible.length
      ? '위의 변수 이름을 눌러 그래프에 표시해 보세요.'
      : '이 범위에는 유일한 해가 없어요. 파라미터 범위를 조절해 보세요.'

  return (
    <div className="solution-chart" ref={containerRef}>
      <div className="sc-legend-row">
        <div className="sc-legend" aria-label="그래프에 표시할 변수">
          {variables.map((name, index) => (
            <button
              key={name}
              type="button"
              className={`sc-legend-button ${visibleVariables.includes(name) ? 'is-visible' : ''}`}
              aria-pressed={visibleVariables.includes(name)}
              aria-label={`${name} 곡선 표시`}
              onClick={() => onToggleVariable(name)}
            >
              <span
                className="sc-legend-dot"
                style={{
                  background: SERIES_COLORS[index % SERIES_COLORS.length],
                }}
              />
              <span>{name}</span>
            </button>
          ))}
        </div>
        <span className="sc-explore-hint">곡선 위에서 값을 살펴보세요</span>
      </div>

      <div className="sc-stage">
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          tabIndex={0}
          aria-labelledby={`${titleId} ${descriptionId}`}
          onPointerMove={handlePointer}
          onPointerDown={handlePointer}
          onPointerLeave={() => onSelectIndex(null)}
          onBlur={() => onSelectIndex(null)}
          onKeyDown={handleKey}
        >
          <title
            id={titleId}
          >{`${parameterName}에 따른 ${modelKind === 'nonlinear' ? '비선형' : '선형'} 방정식 해의 변화`}</title>
          <desc id={descriptionId}>
            좌우 방향키로 값을 탐색하고 Home, End로 처음과 끝으로 이동할 수
            있습니다. 그래프의 탐색 지점은 데이터 표와 연결됩니다.
          </desc>

          {chart && (
            <>
              <text x={PLOT.left} y="12" className="sc-axis-caption">
                해의 값
              </text>
              {chart.yTicks.map((tick, index) => (
                <g key={index}>
                  <line
                    x1={PLOT.left}
                    x2={width - PLOT.right}
                    y1={y(tick)}
                    y2={y(tick)}
                    className={
                      tick === 0 ? 'sc-grid-line sc-zero-line' : 'sc-grid-line'
                    }
                  />
                  <text
                    x={PLOT.left - 13}
                    y={y(tick) + 4}
                    textAnchor="end"
                    className="sc-axis-label"
                  >
                    {axisNumber(tick)}
                  </text>
                </g>
              ))}
              {Array.from({ length: 5 }, (_, index) => {
                const tick = interpolate(chart.minX, chart.maxX, index / 4)
                return (
                  <g key={index}>
                    <line
                      x1={x(tick)}
                      x2={x(tick)}
                      y1={PLOT.top}
                      y2={HEIGHT - PLOT.bottom}
                      className="sc-grid-line sc-grid-vertical"
                    />
                    <text
                      x={x(tick)}
                      y={HEIGHT - PLOT.bottom + 22}
                      textAnchor="middle"
                      className="sc-axis-label"
                    >
                      {axisNumber(tick)}
                    </text>
                  </g>
                )
              })}

              {chart.hasData &&
                visible.map(({ name, index }) => (
                  <path
                    key={name}
                    d={buildPath(index)}
                    stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                    className="sc-curve"
                  />
                ))}

              {chart.hasData && currentInDomain && (
                <g>
                  <line
                    x1={x(currentParameter)}
                    x2={x(currentParameter)}
                    y1={PLOT.top}
                    y2={HEIGHT - PLOT.bottom}
                    className="sc-current-line"
                  />
                  {selectedIndex === null &&
                    currentValues &&
                    visible.map(({ name, index }) => {
                      const value = currentValues[index]
                      if (!Number.isFinite(value)) return null
                      return (
                        <circle
                          key={name}
                          cx={x(currentParameter)}
                          cy={y(value)}
                          r="4.5"
                          fill={SERIES_COLORS[index % SERIES_COLORS.length]}
                          className="sc-active-dot sc-current-dot"
                        />
                      )
                    })}
                  <circle
                    cx={x(currentParameter)}
                    cy={HEIGHT - PLOT.bottom}
                    r="3"
                    fill="#6c827d"
                  />
                </g>
              )}

              {chart.hasData &&
                selectedIndex !== null &&
                activePoint &&
                Number.isFinite(activePoint.parameter) && (
                  <g>
                    <line
                      x1={x(activePoint.parameter)}
                      x2={x(activePoint.parameter)}
                      y1={PLOT.top}
                      y2={HEIGHT - PLOT.bottom}
                      className="sc-crosshair"
                    />
                    {visible.map(({ name, index }) => {
                      const value = activePoint.values?.[index]
                      if (typeof value !== 'number' || !Number.isFinite(value))
                        return null
                      return (
                        <circle
                          key={name}
                          cx={x(activePoint.parameter)}
                          cy={y(value)}
                          r="4.5"
                          fill={SERIES_COLORS[index % SERIES_COLORS.length]}
                          className="sc-active-dot"
                        />
                      )
                    })}
                  </g>
                )}
            </>
          )}
        </svg>

        {(!chart?.hasData || !visible.length) && (
          <div className="sc-empty">
            <span>⌁</span>
            <p>{emptyMessage}</p>
          </div>
        )}

        {chart?.hasData && selectedIndex !== null && activePoint && (
          <div
            className="sc-tooltip"
            style={{
              left: `clamp(8px, ${(x(activePoint.parameter) / width) * 100 + 2}%, calc(100% - 160px))`,
            }}
          >
            <div className="sc-tooltip-heading">
              <span>{parameterName}</span>
              <strong>{String(activePoint.parameter)}</strong>
            </div>
            {activePoint.values ? (
              visible.map(({ name, index }) => (
                <div className="sc-tooltip-value" key={name}>
                  <span>
                    <i
                      style={{
                        background: SERIES_COLORS[index % SERIES_COLORS.length],
                      }}
                    />
                    {name}
                  </span>
                  <strong>{formatNumber(activePoint.values![index])}</strong>
                </div>
              ))
            ) : (
              <p className="sc-tooltip-error">
                {activePoint.error || '유일한 해 없음'}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="sc-chart-footer">
        <span>
          파라미터 <strong>{parameterName || '—'}</strong>
        </span>
        <span className="sc-current-note">
          <i />
          {selectedIndex !== null ? '탐색 지점' : '현재 설정'}
          <strong>
            {activePoint
              ? String(
                  selectedIndex !== null
                    ? activePoint.parameter
                    : currentParameter,
                )
              : '—'}
          </strong>
        </span>
      </div>
      <span className="sc-sr-only" aria-live="polite">
        {selectedIndex !== null && activePoint
          ? `${parameterName}: ${String(activePoint.parameter)}, ${variables.map((name, index) => `${name}: ${activePoint.values ? formatNumber(activePoint.values[index]) : '해 없음'}`).join(', ')}`
          : ''}
      </span>
    </div>
  )
}
