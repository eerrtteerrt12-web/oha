import { conditionNumber } from './conditioning'
import { ModelError, type SolveResult, type SolverOptions } from './index'
import { createNonlinearSolver } from './nonlinear'
import {
  compileNonlinear,
  parseNonlinearExpression,
  type CompiledModel,
  type NonlinearNode,
} from './nonlinear-parser'
import {
  findPolynomialRealRoots,
  polynomialCoefficients,
} from './automatic-polynomial'

export type SearchSummary = {
  method: string
  min: number
  max: number
  attempts: number
  note: string
  truncated?: boolean
}
export type AutomaticOptions = SolverOptions & {
  searchBounds?: { min: number; max: number }
}
export type AutomaticSearchResult = {
  solutions: SolveResult[]
  search: SearchSummary
}
export type AutomaticSolver = {
  (
    source: string,
    parameters: Record<string, number>,
    options?: AutomaticOptions,
  ): AutomaticSearchResult
  solveNear(
    source: string,
    parameters: Record<string, number>,
    seed: SolveResult | number[],
    options?: SolverOptions,
  ): SolveResult
}
type Prepared = {
  source: string
  variables: string[]
  model: CompiledModel
  expression?: NonlinearNode
  helpers: Map<string, NonlinearNode>
}
const preparedCache = new Map<string, Prepared>()
const ROOT_LIMIT = 32
const TIME_BUDGET_MS = 1800
const CONDITION = /^([A-Za-z][A-Za-z0-9_]*)\(\s*(min|max|0)\s*\)\s*=/
const ROOT = /^f\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)\s*=/
const BUILTINS = new Set(['pi', 'e'])

/** Convert ordinary equations to residual equations. In f(x) syntax, plain
 * assignments retain their established meaning as named helper expressions. */
export function normalizeAutomaticModel(
  source: string,
  parameterNames: string[],
) {
  const prepared = prepare(source, parameterNames)
  return { source: prepared.source, variables: [...prepared.variables] }
}

function prepare(source: string, parameterNames: string[]): Prepared {
  if (source.length > 30_000)
    throw new ModelError('수식은 30,000자 이내로 입력하세요.')
  const key = JSON.stringify([source, [...parameterNames].sort()])
  const cached = preparedCache.get(key)
  if (cached) return cached
  const lines = source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((raw, index) => {
      if (/^\s*#@/.test(raw))
        throw new ModelError(
          '자동 탐색에서는 해법 지시문을 사용할 수 없습니다.',
          index + 1,
        )
      return { text: raw.split('#', 1)[0].trim(), line: index + 1 }
    })
    .filter(({ text }) => text && !CONDITION.test(text))
  if (!lines.length) throw new ModelError('계산할 방정식을 입력하세요.')
  const explicit = lines.some(({ text }) => ROOT.test(text))
  const variables: string[] = []
  const helpers = new Map<string, NonlinearNode>()
  let expression: NonlinearNode | undefined
  let canonical: string
  if (explicit) {
    for (const { text, line } of lines) {
      const root = ROOT.exec(text)
      if (root) {
        variables.push(root[1])
        const parsed = parseNonlinearExpression(
          text.slice(root[0].length),
          line,
        )
        if (variables.length === 1) expression = parsed.node
      } else {
        const assignment = /^([A-Za-z][A-Za-z0-9_]*)\s*=([^=]+)$/.exec(text)
        if (assignment)
          helpers.set(
            assignment[1],
            parseNonlinearExpression(assignment[2], line).node,
          )
      }
    }
    canonical = lines.map(({ text }) => text).join('\n')
  } else {
    const parameterSet = new Set(parameterNames)
    const residuals: string[] = []
    for (const { text, line } of lines) {
      const sides = text.split('=')
      if (sides.length > 2)
        throw new ModelError('한 줄에는 등호를 하나만 사용하세요.', line)
      const residual = sides.length === 2 ? `(${sides[0]})-(${sides[1]})` : text
      const parsed = parseNonlinearExpression(residual, line)
      if (residuals.length === 0) expression = parsed.node
      for (const name of parsed.references)
        if (
          !BUILTINS.has(name) &&
          !parameterSet.has(name) &&
          !variables.includes(name)
        )
          variables.push(name)
      residuals.push(residual)
    }
    if (!variables.length)
      throw new ModelError(
        '해를 구할 미지수가 없습니다. 파라미터와 다른 이름의 미지수를 입력하세요.',
      )
    if (variables.length !== residuals.length)
      throw new ModelError(
        `미지수 ${variables.length}개에 대해 독립적인 방정식 ${variables.length}개가 필요합니다. 현재 ${residuals.length}개입니다.`,
      )
    canonical = residuals
      .map((residual, index) => `f(${variables[index]}) = ${residual}`)
      .join('\n')
  }
  if (variables.length > 16)
    throw new ModelError(
      '자동 탐색의 미지수는 최대 16개까지 사용할 수 있습니다.',
    )
  const metadata =
    variables.length === 1
      ? `${variables[0]}(min) = -100\n${variables[0]}(max) = 100`
      : variables.map((name) => `${name}(0) = 1`).join('\n')
  // The existing strict compiler validates names, helper dependencies and safe
  // expression syntax; these synthetic conditions are only for compilation.
  const model = compileNonlinear(`${canonical}\n${metadata}`, parameterNames)
  const prepared = {
    source: canonical,
    variables: model.variables,
    model,
    expression,
    helpers,
  }
  if (preparedCache.size >= 16)
    preparedCache.delete(preparedCache.keys().next().value!)
  preparedCache.set(key, prepared)
  return prepared
}

function validateParameters(parameters: Record<string, number>) {
  for (const [name, value] of Object.entries(parameters))
    if (!Number.isFinite(value))
      throw new ModelError(`파라미터 '${name}'에 유한한 숫자가 필요합니다.`)
}
function boundsFor(options: AutomaticOptions) {
  const bounds = options.searchBounds ?? { min: -100, max: 100 }
  if (
    !Number.isFinite(bounds.min) ||
    !Number.isFinite(bounds.max) ||
    bounds.min >= bounds.max
  )
    throw new ModelError(
      '자동 탐색 범위에는 최소값보다 큰 유한한 최대값을 입력하세요.',
    )
  return bounds
}
function unique(solutions: SolveResult[], result: SolveResult) {
  if (!result.values.every(Number.isFinite)) return false
  const duplicate = solutions.some((other) => sameSolution(result, other))
  if (duplicate) return false
  solutions.push(result)
  return true
}
function sameSolution(result: SolveResult, other: SolveResult) {
  return result.values.every(
    (value, i) =>
      Math.abs(value - other.values[i]) <=
      2e-7 *
        Math.max(Number.MIN_VALUE, Math.abs(value), Math.abs(other.values[i])),
  )
}
function sortSolutions(solutions: SolveResult[]) {
  solutions.sort((a, b) => {
    for (let index = 0; index < a.values.length; index++) {
      const difference = a.values[index] - b.values[index]
      if (difference !== 0) return difference
    }
    return 0
  })
}
function tryScalar(
  model: CompiledModel,
  parameters: Record<string, number>,
  value: number,
) {
  if (!Number.isFinite(value)) return undefined
  try {
    return model.evaluate([value], parameters).residuals[0]
  } catch (error) {
    if (!(error instanceof ModelError)) throw error
    return undefined
  }
}
function derivative(
  model: CompiledModel,
  parameters: Record<string, number>,
  value: number,
  residual: number,
) {
  let step = Math.cbrt(Number.EPSILON) * (Math.abs(value) || 1)
  for (let attempt = 0; attempt < 14; attempt++, step /= 4) {
    const plus = tryScalar(model, parameters, value + step)
    const minus = tryScalar(model, parameters, value - step)
    if (plus !== undefined && minus !== undefined)
      return (plus - minus) / (value + step - (value - step))
    if (plus !== undefined) return (plus - residual) / (value + step - value)
    if (minus !== undefined)
      return (residual - minus) / (value - (value - step))
  }
  return NaN
}
function hasLocalVariation(
  model: CompiledModel,
  parameters: Record<string, number>,
  value: number,
) {
  const step = 1e-5 * (Math.abs(value) || 1)
  const samples = [value - step, value + step]
    .map((near) => tryScalar(model, parameters, near))
    .filter((residual): residual is number => residual !== undefined)
  // Both available sides must vary. Otherwise a rounded underflow tail or a
  // plateau can be mistaken for an isolated real root. Domain endpoints such
  // as sqrt(x)=0 can legitimately have only one available side.
  return samples.length > 0 && samples.every((residual) => residual !== 0)
}

function smallLocalResidual(
  model: CompiledModel,
  parameters: Record<string, number>,
  value: number,
  residual: number,
) {
  const step = 1e-5 * (Math.abs(value) || 1)
  const nearby = [value - step, value + step]
    .map((near) => tryScalar(model, parameters, near))
    .filter((sample): sample is number => sample !== undefined)
  return (
    nearby.length > 0 &&
    Math.abs(residual) <= Math.max(...nearby.map(Math.abs)) * 1e-8
  )
}

/** Newton refinement requires a small correction as well as a reduced
 * residual, so exponentially small asymptotic tails are not finite roots. */
function scalarNear(
  prepared: Prepared,
  parameters: Record<string, number>,
  seed: number,
  bounds?: { min: number; max: number },
) {
  const model = prepared.model
  let value = seed
  let initial: number | undefined
  for (let iteration = 0; iteration < 100; iteration++) {
    const residual = tryScalar(model, parameters, value)
    if (residual === undefined) break
    initial ??= Math.abs(residual)
    if (residual === 0 && hasLocalVariation(model, parameters, value))
      return { value, iterations: iteration }
    // A repeated root at exactly zero converges only linearly under Newton,
    // so a relative step test cannot terminate there. Snap only after the
    // iterates have already approached zero, and verify it in the model.
    if (
      seed !== 0 &&
      Math.abs(value) <= Math.abs(seed) * 1e-9 &&
      tryScalar(model, parameters, 0) === 0 &&
      hasLocalVariation(model, parameters, 0)
    )
      return { value: 0, iterations: iteration }
    const slope = derivative(model, parameters, value, residual)
    if (!Number.isFinite(slope) || slope === 0) break
    const correction = residual / slope
    if (!Number.isFinite(correction)) break
    const small =
      Math.abs(correction) <=
      1e-11 * Math.max(Number.MIN_VALUE, Math.abs(value))
    if (
      small &&
      (Math.abs(residual) <= Math.max(initial * 1e-10, Number.MIN_VALUE) ||
        smallLocalResidual(model, parameters, value, residual)) &&
      hasLocalVariation(model, parameters, value)
    )
      return { value, iterations: iteration }
    let accepted = false
    for (let search = 0, alpha = 1; search < 24; search++, alpha /= 2) {
      const candidate = value - alpha * correction
      if (
        !Number.isFinite(candidate) ||
        (bounds && (candidate < bounds.min || candidate > bounds.max))
      )
        continue
      const next = tryScalar(model, parameters, candidate)
      if (
        next !== undefined &&
        (Math.abs(next) < Math.abs(residual) || next === 0)
      ) {
        if (candidate === value) break
        value = candidate
        accepted = true
        break
      }
    }
    if (!accepted) break
  }
  throw new ModelError(
    '선택한 해 주변에서 유한한 실근으로 수렴하지 않았습니다. 해가 합쳐지거나 사라지는 지점일 수 있습니다.',
  )
}
function scalarResult(
  prepared: Prepared,
  parameters: Record<string, number>,
  value: number,
  options: SolverOptions,
  iterations = 0,
  slopeOverride?: number,
): SolveResult {
  const start = performance.now()
  const evaluation = prepared.model.evaluate([value], parameters)
  const slope =
    slopeOverride ??
    derivative(prepared.model, parameters, value, evaluation.residuals[0])
  const matrix = [[slope]]
  let condition = NaN
  let conditionError: string | undefined
  const conditionNorm = options.conditionNorm ?? 'infinity'
  if (conditionNorm !== 'infinity' && conditionNorm !== '2')
    throw new ModelError('조건수 계산 방법을 확인해 주세요.')
  if (options.computeCondition !== false) {
    try {
      condition = conditionNumber(matrix, conditionNorm)
    } catch {
      conditionError = '해에서의 Jacobian 조건수를 계산하지 못했습니다.'
    }
  }
  const warnings = [
    '자동 탐색에서 검증한 실근입니다. 수치 탐색은 임의의 함수에 대한 모든 해를 보장하지 않습니다.',
  ]
  if (condition === Infinity || slope === 0)
    warnings.push(
      '이 해에서는 Jacobian이 특이합니다. 중근 또는 민감한 해일 수 있으므로 잔차와 주변 거동을 함께 확인하세요.',
    )
  return {
    kind: 'nonlinear',
    variables: prepared.variables,
    values: [Object.is(value, -0) ? 0 : value],
    auxiliary: evaluation.auxiliary,
    matrix,
    rhs: evaluation.residuals.map((entry) => -entry),
    residuals: evaluation.residuals,
    maxResidual: Math.abs(evaluation.residuals[0]),
    condition,
    conditionNorm,
    ...(conditionError ? { conditionError } : {}),
    engine: 'javascript',
    iterations,
    method: '자동 실근 탐색 · 수치 검증',
    durationMs: performance.now() - start,
    warnings,
  }
}
function radicalInverse(index: number, base: number) {
  let result = 0,
    fraction = 1 / base
  while (index > 0) {
    result += (index % base) * fraction
    index = Math.floor(index / base)
    fraction /= base
  }
  return result
}
function systemSeeds(size: number, bounds: { min: number; max: number }) {
  const seeds: number[][] = []
  const add = (values: number[]) => {
    if (
      values.every((value) => value >= bounds.min && value <= bounds.max) &&
      !seeds.some((seed) => seed.every((value, i) => value === values[i]))
    )
      seeds.push(values)
  }
  const middle = bounds.min / 2 + bounds.max / 2
  const width = bounds.max / 2 - bounds.min / 2
  for (const value of [0, 1, -1, middle, bounds.min, bounds.max])
    add(Array(size).fill(value))
  if (size === 2) {
    const coordinates = [
      ...new Set(
        [bounds.min, bounds.max, middle, -10, -3, -1, 0, 1, 3, 10].filter(
          (value) => value >= bounds.min && value <= bounds.max,
        ),
      ),
    ]
    for (const x of coordinates) for (const y of coordinates) add([x, y])
  }
  const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53]
  const limit = size <= 2 ? 128 : size <= 4 ? 80 : 48
  for (let index = 1; seeds.length < limit && index <= limit * 8; index++)
    add(
      Array.from(
        { length: size },
        (_, j) => middle + width * (2 * radicalInverse(index, primes[j]) - 1),
      ),
    )
  return seeds.slice(0, limit)
}

/** Search is deterministic and bounded. It returns discovered finite real
 * solutions, never a mathematical claim that arbitrary equations are complete. */
export async function createAutomaticSolver(
  wasmBinary?: BufferSource,
): Promise<AutomaticSolver> {
  const manual = await createNonlinearSolver(wasmBinary)
  const solveNear: AutomaticSolver['solveNear'] = (
    source,
    parameters,
    seed,
    options = {},
  ) => {
    validateParameters(parameters)
    const prepared = prepare(source, Object.keys(parameters))
    const values = Array.isArray(seed) ? seed : seed.values
    if (
      values.length !== prepared.variables.length ||
      !values.every(Number.isFinite)
    )
      throw new ModelError('추적할 해의 미지수 값이 올바르지 않습니다.')
    if (prepared.variables.length === 1) {
      const refined = scalarNear(prepared, parameters, values[0])
      return scalarResult(
        prepared,
        parameters,
        refined.value,
        options,
        refined.iterations,
      )
    }
    return manual(
      `${prepared.source}\n${prepared.variables.map((name, i) => `${name}(0) = ${values[i]}`).join('\n')}`,
      parameters,
      options,
    )
  }
  const search = ((
    source: string,
    parameters: Record<string, number>,
    options: AutomaticOptions = {},
  ): AutomaticSearchResult => {
    const start = performance.now()
    validateParameters(parameters)
    if (
      options.conditionNorm !== undefined &&
      options.conditionNorm !== 'infinity' &&
      options.conditionNorm !== '2'
    )
      throw new ModelError('조건수 계산 방법을 확인해 주세요.')
    const prepared = prepare(source, Object.keys(parameters))
    let bounds = boundsFor(options)
    const solutions: SolveResult[] = []
    let attempts = 0,
      truncated = false
    const timedOut = () => performance.now() - start > TIME_BUDGET_MS
    const inBounds = (values: number[]) =>
      values.every(
        (value) =>
          value >= bounds.min - 1e-9 * Math.max(1, Math.abs(bounds.min)) &&
          value <= bounds.max + 1e-9 * Math.max(1, Math.abs(bounds.max)),
      )
    const add = (result: SolveResult) => {
      if (!inBounds(result.values)) return
      if (solutions.length >= ROOT_LIMIT) {
        if (!solutions.some((other) => sameSolution(result, other)))
          truncated = true
        return
      }
      unique(solutions, result)
    }
    let method: string
    let note: string
    if (prepared.variables.length === 1) {
      const constants = { pi: Math.PI, e: Math.E, ...parameters }
      const coefficients = prepared.expression
        ? polynomialCoefficients(
            prepared.expression,
            prepared.variables[0],
            constants,
            prepared.helpers,
          )
        : null
      if (coefficients) {
        method = '다항식 실근 분리 · 수치 검증'
        const isolated = findPolynomialRealRoots(
          coefficients,
          options.searchBounds,
        )
        bounds = { min: isolated.min, max: isolated.max }
        if (isolated.identicallyZero)
          throw new ModelError(
            '이 방정식은 미지수와 무관하게 0=0이 됩니다. 해를 특정할 독립적인 방정식이 필요합니다.',
          )
        for (const value of isolated.roots) {
          attempts++
          let slope = 0
          for (let i = coefficients.length - 1; i > 0; i--)
            slope = slope * value + i * coefficients[i]
          const residual = tryScalar(prepared.model, parameters, value)
          // Expanded coefficient arithmetic can produce near-zero extrema
          // that are not roots of the original expression. Validate against
          // that original expression before publishing any candidate.
          if (
            residual === undefined ||
            !hasLocalVariation(prepared.model, parameters, value)
          )
            continue
          if (
            residual !== 0 &&
            (slope === 0 ||
              !smallLocalResidual(prepared.model, parameters, value, residual))
          )
            continue
          add(scalarResult(prepared, parameters, value, options, 0, slope))
        }
        note =
          '다항식의 계수에서 계산한 범위에서 실근을 수치적으로 분리·검증했습니다. 반올림과 중근의 영향으로 수치적 완전성을 보장하지 않습니다.'
      } else {
        method = '구간 분할 · 다중 시작점 Newton'
        note =
          '표시한 범위 안에서 여러 구간과 시작점으로 유한한 실근을 탐색했습니다. 범위 밖의 해, 가까운 중근 또는 일부 해는 누락될 수 있습니다.'
        const count = 2048
        let previousX: number | undefined, previousY: number | undefined
        for (let index = 0; index <= count; index++) {
          if (timedOut()) {
            truncated = true
            break
          }
          const value =
            bounds.min * (1 - index / count) + bounds.max * (index / count)
          const residual = tryScalar(prepared.model, parameters, value)
          if (residual !== undefined) {
            if (
              residual === 0 &&
              hasLocalVariation(prepared.model, parameters, value)
            )
              add(scalarResult(prepared, parameters, value, options))
            if (
              previousY !== undefined &&
              previousX !== undefined &&
              residual !== 0 &&
              Math.sign(previousY) !== Math.sign(residual)
            ) {
              attempts++
              try {
                const sourceWithBounds = `${prepared.source}\n${prepared.variables[0]}(min) = ${previousX}\n${prepared.variables[0]}(max) = ${value}`
                add(manual(sourceWithBounds, parameters, options))
              } catch (error) {
                if (!(error instanceof ModelError)) throw error
              }
            }
          }
          previousX = value
          previousY = residual
        }
        // Newton adds tangential roots that do not change sign on a grid.
        for (let index = 0; index <= 96 && !timedOut(); index++) {
          attempts++
          const seed = bounds.min * (1 - index / 96) + bounds.max * (index / 96)
          try {
            const refined = scalarNear(prepared, parameters, seed, bounds)
            add(
              scalarResult(
                prepared,
                parameters,
                refined.value,
                options,
                refined.iterations,
              ),
            )
          } catch (error) {
            if (!(error instanceof ModelError)) throw error
          }
        }
        if (timedOut()) truncated = true
      }
    } else {
      method = '다중 시작점 감쇠 Newton'
      note =
        '표시한 범위의 여러 시작점에서 수렴한 실수 해를 모았습니다. 수치 탐색으로 모든 해를 보장하지 않으며 특이한 해나 작은 수렴 영역의 해는 누락될 수 있습니다.'
      for (const seed of systemSeeds(prepared.variables.length, bounds)) {
        if (timedOut()) {
          truncated = true
          break
        }
        attempts++
        try {
          add(solveNear(source, parameters, seed, options))
        } catch (error) {
          if (!(error instanceof ModelError)) throw error
        }
      }
    }
    sortSolutions(solutions)
    if (truncated) note += ' 탐색 시간 또는 표시 개수 제한에 도달했습니다.'
    const durationMs = performance.now() - start
    for (const result of solutions) result.durationMs = durationMs
    return {
      solutions,
      search: {
        method,
        ...bounds,
        attempts,
        note,
        ...(truncated ? { truncated: true } : {}),
      },
    }
  }) as AutomaticSolver
  search.solveNear = solveNear
  return search
}
