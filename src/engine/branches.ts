import {
  ModelError,
  type SolvePayload,
  type SolveResult,
  type SolverOptions,
  type SweepPoint,
} from './index'
import { parameterValues, type SweepSettings } from './sweep'

export type NearSolver = (
  source: string,
  parameters: Record<string, number>,
  seed: SolveResult | number[],
  options?: SolverOptions,
) => SolveResult

type Sweeps = Pick<
  SolvePayload,
  'sweep' | 'dataset' | 'datasetError' | 'sweepName'
>
type State = { parameter: number; values: number[] }
type Path = { current: State; previous?: State }

/** Follow one selected root, rather than re-running the global search at each
 * parameter. Continuation cannot prove root identity at crossings or folds.
 * Once a direction loses its branch, its remaining rows stay explicit gaps. */
export function computeBranchSweeps(
  solveNear: NearSolver,
  source: string,
  parameters: Record<string, number>,
  settings: SweepSettings | null,
  selected: SolveResult,
): Sweeps {
  if (!settings) return { sweep: [], dataset: [], sweepName: '' }
  const { name, min, max, steps, step } = settings
  const origin = parameters[name]
  if (
    !Object.hasOwn(parameters, name) ||
    ![origin, min, max, steps].every(Number.isFinite) ||
    max <= min
  )
    throw new ModelError('시뮬레이션 파라미터와 범위를 확인해 주세요.')

  const graphCount = Math.min(201, Math.max(2, Math.round(steps)))
  const graphParameters = Array.from({ length: graphCount }, (_, i) => {
    const fraction = i / (graphCount - 1)
    return min * (1 - fraction) + max * fraction
  })
  let datasetParameters: number[] = []
  let datasetError: string | undefined
  try {
    datasetParameters = parameterValues(
      min,
      max,
      step,
      Math.min(500, settings.maxPoints ?? 500),
    )
  } catch (error) {
    datasetError =
      error instanceof Error ? error.message : '데이터를 생성하지 못했습니다.'
  }

  const cache = new Map<number, SweepPoint>([
    [origin, { parameter: origin, values: [...selected.values] }],
  ])
  const targets = [...new Set([...graphParameters, ...datasetParameters])]
  const initial: State = { parameter: origin, values: [...selected.values] }
  let calls = 0

  const correct = (path: Path, target: number): State => {
    if (++calls > 6000)
      throw new ModelError(
        '분기 추적 계산 한도에 도달했습니다. 범위를 줄여 주세요.',
      )
    const { current, previous } = path
    const ratio = previous
      ? Math.min(
          4,
          Math.abs(
            (target - current.parameter) /
              (current.parameter - previous.parameter),
          ),
        )
      : 0
    const predictor = current.values.map(
      (value, i) =>
        value + (previous ? ratio * (value - previous.values[i]) : 0),
    )
    const result = solveNear(
      source,
      { ...parameters, [name]: target },
      predictor,
      { computeCondition: false },
    )
    if (
      result.values.length !== selected.values.length ||
      !result.values.every(Number.isFinite) ||
      result.variables.some((variable, i) => variable !== selected.variables[i])
    )
      throw new ModelError('추적 중인 해의 미지수가 변경되었습니다.')

    // A large corrector step can mean Newton converged to a different root.
    // Retry smaller parameter steps before accepting such a discontinuity.
    let correction = 0
    let predictedMotion = 0
    for (let i = 0; i < result.values.length; i++) {
      const scale = Math.max(
        1,
        Math.abs(current.values[i]),
        Math.abs(predictor[i]),
      )
      correction = Math.max(
        correction,
        Math.abs(result.values[i] - predictor[i]) / scale,
      )
      predictedMotion = Math.max(
        predictedMotion,
        Math.abs(predictor[i] - current.values[i]) / scale,
      )
    }
    if (correction > (previous ? Math.max(0.02, predictedMotion * 2) : 0.2))
      throw new ModelError(
        '이전 해에서 멀리 떨어진 해로 이동해 추적 간격을 줄였습니다.',
      )

    // At a sign change, check that the correction can return to the old root.
    // A valid branch may cross zero; this also rejects ±root switching without
    // forbidding ordinary zero crossings such as x = parameter.
    if (result.values.some((value, i) => value * current.values[i] < 0)) {
      if (++calls > 6000)
        throw new ModelError('분기 추적 계산 한도에 도달했습니다.')
      const reverse = solveNear(
        source,
        { ...parameters, [name]: current.parameter },
        result.values,
        { computeCondition: false },
      )
      if (
        reverse.values.length !== current.values.length ||
        reverse.values.some(
          (value, i) =>
            !Number.isFinite(value) ||
            Math.abs(value - current.values[i]) >
              1e-6 * Math.max(1, Math.abs(value), Math.abs(current.values[i])),
        )
      )
        throw new ModelError(
          '다른 해로의 이동이 감지되어 선택한 분기 추적을 중단했습니다.',
        )
    }
    return { parameter: target, values: [...result.values] }
  }

  const advance = (path: Path, target: number, depth = 0): Path => {
    try {
      return { previous: path.current, current: correct(path, target) }
    } catch (error) {
      const middle = path.current.parameter / 2 + target / 2
      if (
        depth >= 10 ||
        calls >= 6000 ||
        middle === path.current.parameter ||
        middle === target
      )
        throw error
      const halfway = advance(path, middle, depth + 1)
      return advance(halfway, target, depth + 1)
    }
  }

  for (const direction of [-1, 1]) {
    let path: Path = { current: initial }
    let loss: string | undefined
    const ordered = targets
      .filter((value) => (value - origin) * direction > 0)
      .sort((a, b) => direction * (a - b))
    for (const parameter of ordered) {
      if (!loss) {
        try {
          path = advance(path, parameter)
          cache.set(parameter, { parameter, values: [...path.current.values] })
          continue
        } catch (error) {
          loss = `선택한 해의 분기를 더 이상 추적할 수 없습니다. ${error instanceof Error ? error.message : '계산 실패'}`
        }
      }
      cache.set(parameter, { parameter, values: null, error: loss })
    }
  }

  return {
    sweep: graphParameters.map((value) => cache.get(value)!),
    dataset: datasetParameters.map((value) => cache.get(value)!),
    ...(datasetError ? { datasetError } : {}),
    sweepName: name,
  }
}
