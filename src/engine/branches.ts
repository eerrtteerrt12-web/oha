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

function createContinuation(
  solveNear: NearSolver,
  source: string,
  selected: SolveResult,
  parametersAt: (parameter: number) => Record<string, number>,
) {
  let calls = 0
  const solve = (parameter: number, values: number[]) => {
    if (++calls > 6000)
      throw new ModelError(
        '분기 추적 계산 한도에 도달했습니다. 범위를 줄여 주세요.',
      )
    const result = solveNear(source, parametersAt(parameter), values, {
      computeCondition: false,
    })
    if (
      result.values.length !== selected.values.length ||
      !result.values.every(Number.isFinite) ||
      result.variables.length !== selected.variables.length ||
      result.variables.some((variable, i) => variable !== selected.variables[i])
    )
      throw new ModelError('추적 중인 해의 미지수가 변경되었습니다.')
    return result
  }
  const correct = (path: Path, target: number): State => {
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
    const result = solve(target, predictor)
    for (let i = 0; i < result.values.length; i++) {
      const motion = Math.abs(predictor[i] - current.values[i])
      const rounding =
        4096 *
        Number.EPSILON *
        Math.max(
          Number.MIN_VALUE,
          Math.abs(current.values[i]),
          Math.abs(predictor[i]),
          Math.abs(result.values[i]),
        )
      // Trust the local motion, not the distance of a root from zero. The
      // old |x|-scaled allowance accepted much larger period jumps at x=80
      // than at x=0. Tiny branches need a correspondingly tiny allowance.
      const allowance = previous ? Math.max(rounding, motion * 2) : 0.2
      if (Math.abs(result.values[i] - predictor[i]) > allowance)
        throw new ModelError(
          '이전 해에서 멀리 떨어진 해로 이동해 추적 간격을 줄였습니다.',
        )
    }

    // Check every step, including same-sign roots and tiny-valued roots.
    // Checking sign changes alone misses jumps to another periodic branch.
    // At a fold the endpoint can have a zero derivative. A tiny displacement
    // toward the preceding point permits the reverse solve to leave that
    // endpoint while keeping the seed close to the newly corrected root.
    const reverseSeed = result.values.map(
      (value, i) => value * 0.999 + current.values[i] * 0.001,
    )
    const reverse = solve(current.parameter, reverseSeed)
    if (
      reverse.values.some((value, i) => {
        const rounding =
          4096 *
          Number.EPSILON *
          Math.max(
            Number.MIN_VALUE,
            Math.abs(value),
            Math.abs(current.values[i]),
          )
        const motion = Math.max(
          Math.abs(result.values[i] - current.values[i]),
          Math.abs(predictor[i] - current.values[i]),
        )
        return (
          Math.abs(value - current.values[i]) >
          Math.max(rounding, motion * 1e-7)
        )
      })
    )
      throw new ModelError(
        '다른 해로의 이동이 감지되어 선택한 분기 추적을 중단했습니다.',
      )
    return { parameter: target, values: [...result.values] }
  }
  const advance = (path: Path, target: number, depth = 0): Path => {
    try {
      return { previous: path.current, current: correct(path, target) }
    } catch (error) {
      const middle = path.current.parameter / 2 + target / 2
      if (
        depth >= 40 ||
        calls >= 6000 ||
        middle === path.current.parameter ||
        middle === target
      )
        throw error
      const halfway = advance(path, middle, depth + 1)
      return advance(halfway, target, depth + 1)
    }
  }
  return advance
}

/** Continue a pinned solution through a straight path in parameter space.
 * The seed remains attached to its immutable origin instead of being matched
 * to an index in a fresh global search. Crossings cannot prove branch identity. */
export function continueRoot(
  solveNear: NearSolver,
  source: string,
  originParameters: Record<string, number>,
  targetParameters: Record<string, number>,
  selected: SolveResult,
  options: SolverOptions = {},
): SolveResult {
  const names = Object.keys(originParameters)
  if (
    names.length !== Object.keys(targetParameters).length ||
    names.some(
      (name) =>
        !Object.hasOwn(targetParameters, name) ||
        !Number.isFinite(originParameters[name]) ||
        !Number.isFinite(targetParameters[name]),
    )
  )
    throw new ModelError(
      '추적할 파라미터가 변경되었습니다. 해를 다시 선택해 주세요.',
    )
  let path: Path = { current: { parameter: 0, values: [...selected.values] } }
  if (names.some((name) => originParameters[name] !== targetParameters[name])) {
    const advance = createContinuation(
      solveNear,
      source,
      selected,
      (fraction) =>
        Object.fromEntries(
          names.map((name) => [
            name,
            originParameters[name] * (1 - fraction) +
              targetParameters[name] * fraction,
          ]),
        ),
    )
    for (let i = 1; i <= 16; i++) path = advance(path, i / 16)
  }
  // Include condition diagnostics even if the parameters did not change.
  return solveNear(source, targetParameters, path.current.values, options)
}

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
  const advance = createContinuation(
    solveNear,
    source,
    selected,
    (parameter) => ({ ...parameters, [name]: parameter }),
  )

  for (const direction of [-1, 1]) {
    let path: Path = { current: initial }
    let loss: string | undefined
    const ordered = targets
      .filter((value) => (value - origin) * direction > 0)
      .sort((a, b) => direction * (a - b))
    for (const parameter of ordered) {
      if (!loss) {
        try {
          // Graph and table grids can express the same decimal one ULP
          // apart. Such duplicate samples must not erase useful secant
          // history and turn the next ordinary step into a large jump.
          const duplicateTolerance =
            64 *
            Number.EPSILON *
            Math.max(
              Number.MIN_VALUE,
              Math.abs(parameter),
              Math.abs(path.current.parameter),
            )
          if (
            Math.abs(parameter - path.current.parameter) <= duplicateTolerance
          ) {
            cache.set(parameter, {
              parameter,
              values: [...path.current.values],
            })
            continue
          }
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
