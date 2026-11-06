import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import SolutionChart, {
  type SolutionChartProps,
} from '../src/components/SolutionChart'
import { fittedDomain, fraction } from '../src/components/chart-domain'

describe('data-fitted chart axes', () => {
  it('preserves local variation for a periodic root far from zero', () => {
    const [min, max, ticks] = fittedDomain([-40.05, -39.8, -39.3])
    expect(min).toBeLessThan(-40.05)
    expect(max).toBeGreaterThan(-39.3)
    expect(max).toBeLessThan(0)
    expect(max - min).toBeLessThan(2)
    expect(ticks.length).toBeGreaterThan(2)
  })

  it('includes zero naturally when a curve crosses zero', () => {
    const [min, max] = fittedDomain([-0.3, 0, 0.7])
    expect(min).toBeLessThan(0)
    expect(max).toBeGreaterThan(0)
  })

  it.each([-40, 40, 0])(
    'gives a constant at %s a finite local range',
    (value) => {
      const [min, max] = fittedDomain([value, value])
      expect(min).toBeLessThan(value)
      expect(max).toBeGreaterThan(value)
      if (value !== 0) expect(max - min).toBeLessThan(Math.abs(value))
    },
  )

  it.each([
    [1e308, 1.01e308],
    [-Number.MAX_VALUE, Number.MAX_VALUE],
    [Number.MAX_VALUE],
    [-Number.MAX_VALUE],
    [1e-320, 1.1e-320],
    [Number.MIN_VALUE],
    [-Number.MIN_VALUE, Number.MIN_VALUE],
  ])('keeps finite coordinates for extreme values %j', (...values) => {
    const [min, max, ticks] = fittedDomain(values)
    expect(Number.isFinite(min)).toBe(true)
    expect(Number.isFinite(max)).toBe(true)
    expect(min).toBeLessThan(max)
    expect(ticks.every(Number.isFinite)).toBe(true)
    expect(new Set(ticks).size).toBe(ticks.length)
    expect(
      ticks.every((tick, index) => index === 0 || tick > ticks[index - 1]),
    ).toBe(true)
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(min)
      expect(value).toBeLessThanOrEqual(max)
      expect(Number.isFinite(fraction(value, min, max))).toBe(true)
      expect(fraction(value, min, max)).toBeGreaterThanOrEqual(0)
      expect(fraction(value, min, max)).toBeLessThanOrEqual(1)
    }
  })

  it('ignores non-finite values without contaminating the axis', () => {
    expect(fittedDomain([NaN, Infinity, -Infinity])).toEqual(fittedDomain([]))
    expect(fittedDomain([NaN, -40, Infinity])).toEqual(fittedDomain([-40]))
  })
})

const baseProps: SolutionChartProps = {
  points: [
    { parameter: 0, values: [-40] },
    { parameter: 0.5, values: null, error: '해 없음' },
    { parameter: 1, values: [-39.2] },
  ],
  variables: ['x'],
  parameterName: 'target',
  currentParameter: 0,
  selectedIndex: null,
  onSelectIndex: () => {},
  visibleVariables: ['x'],
  onToggleVariable: () => {},
}

function renderChart(overrides: Partial<SolutionChartProps> = {}) {
  return renderToStaticMarkup(
    createElement(SolutionChart, { ...baseProps, ...overrides }),
  )
}

describe('chart markers and missing solve points', () => {
  it('does not connect a curve across an invalid solve point', () => {
    const markup = renderChart()
    const path = markup.match(
      /d="([^"]+)" stroke="#[^"]+" class="sc-curve"/,
    )?.[1]
    expect(path).toBeDefined()
    expect(path!.match(/M/g)).toHaveLength(2)
    expect(path).not.toContain('L')
  })

  it('fits an exact current solution that lies between graph samples', () => {
    const markup = renderChart({ currentParameter: 0.25, currentValues: [-42] })
    const coordinate = Number(
      markup.match(/cy="([^"]+)" r="4.5"[^>]+sc-current-dot/)?.[1],
    )
    expect(coordinate).toBeGreaterThanOrEqual(24)
    expect(coordinate).toBeLessThanOrEqual(253)
    expect(markup).not.toMatch(/NaN|Infinity/)
  })

  it('fits a selected dataset solution without including a hidden current marker', () => {
    const markup = renderChart({
      selectionPoints: [{ parameter: 0.25, values: [-42] }],
      selectedIndex: 0,
      currentValues: [1000],
    })
    const coordinate = Number(
      markup.match(/cy="([^"]+)" r="4.5"[^>]+sc-active-dot/)?.[1],
    )
    expect(coordinate).toBeGreaterThanOrEqual(24)
    expect(coordinate).toBeLessThanOrEqual(253)
    expect(markup).not.toContain('sc-current-dot')
    expect(markup).not.toContain('>1,000<')
    const yLabels = [
      ...markup.matchAll(/text-anchor="end" class="sc-axis-label">([^<]+)</g),
    ]
    expect(yLabels.every((match) => Number(match[1]) < 0)).toBe(true)
  })

  it('keeps masked null points out of the extent and shows their failure', () => {
    const markup = renderChart({ selectedIndex: 1 })
    expect(markup).toContain('해 없음')
    expect(markup).not.toContain('sc-active-dot')
    expect(markup).not.toMatch(/NaN|Infinity/)
  })

  it('enlarges the SVG plotting area in expanded results', () => {
    const normal = renderChart()
      .match(/viewBox="([^"]+)"/)?.[1]
      .split(' ')
      .map(Number)
    const expanded = renderChart({ expanded: true })
      .match(/viewBox="([^"]+)"/)?.[1]
      .split(' ')
      .map(Number)
    expect(normal).toBeDefined()
    expect(expanded![3]).toBeGreaterThan(normal![3] + 100)
  })
})
