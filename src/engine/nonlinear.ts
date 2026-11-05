import { conditionNumber } from './conditioning'
import { ModelError, type SolveResult, type SolverOptions } from './index'
import { compileNonlinear, type CompiledModel } from './nonlinear-parser'

type WasmExports = {
  memory: WebAssembly.Memory
  solve: (size: number) => number
}
type Evaluation = ReturnType<CompiledModel['evaluate']>
type Evaluator = (values: number[]) => Evaluation
type IterationResult = {
  values: number[]
  evaluation: Evaluation
  iterations: number
  matrix?: number[][]
}
const MAX_ITERATIONS = 200
const RESIDUAL_TOLERANCE = 1e-11
const STEP_TOLERANCE = 1e-10
const BRACKET_TOLERANCE = 1e-12
const PIVOT_TOLERANCE = 1e-12

function rankError(): never {
  throw new ModelError(
    '현재 추정값에서 Jacobian이 특이하거나 독립적인 수식이 부족합니다. 중복 수식과 초기 추정값을 확인해 주세요.',
  )
}

/** The shared WASM kernel receives an equilibrated augmented matrix. */
function linearStep(
  matrix: number[][],
  rhs: number[],
  wasm: WasmExports | null,
) {
  const augmented = matrix.map((row, i) => {
    const scale = Math.max(...row.map(Math.abs))
    if (!scale) rankError()
    const result = [...row.map((value) => value / scale), rhs[i] / scale]
    if (result.some((value) => !Number.isFinite(value)))
      throw new ModelError(
        'Newton 보정량이 수치 범위를 벗어났습니다. 수식의 단위와 초기 추정값을 조정해 주세요.',
      )
    return result
  })
  const n = augmented.length
  if (wasm) {
    new Float64Array(wasm.memory.buffer).set(augmented.flat(), 0)
    if (wasm.solve(n) !== 0) rankError()
    const values = Array.from(new Float64Array(wasm.memory.buffer, 65536, n))
    if (!values.every(Number.isFinite)) rankError()
    return values
  }
  for (let k = 0; k < n; k++) {
    let pivot = k
    for (let row = k + 1; row < n; row++)
      if (Math.abs(augmented[row][k]) > Math.abs(augmented[pivot][k]))
        pivot = row
    if (Math.abs(augmented[pivot][k]) < PIVOT_TOLERANCE) rankError()
    ;[augmented[k], augmented[pivot]] = [augmented[pivot], augmented[k]]
    for (let row = k + 1; row < n; row++) {
      const factor = augmented[row][k] / augmented[k][k]
      for (let col = k + 1; col <= n; col++)
        augmented[row][col] -= factor * augmented[k][col]
      augmented[row][k] = 0
    }
  }
  const values = Array<number>(n).fill(0)
  for (let row = n - 1; row >= 0; row--) {
    let value = augmented[row][n]
    for (let col = row + 1; col < n; col++)
      value -= augmented[row][col] * values[col]
    values[row] = value / augmented[row][row]
  }
  if (!values.every(Number.isFinite)) rankError()
  return values
}

/** Domain-safe differences use both sides when possible, otherwise one side.
 * Shrinking before a one-sided fallback keeps log/sqrt derivatives local. */
function jacobian(evaluate: Evaluator, values: number[], base: number[]) {
  const n = values.length
  const result = Array.from({ length: n }, () => Array<number>(n).fill(0))
  for (let col = 0; col < n; col++) {
    let step = Math.cbrt(Number.EPSILON) * Math.max(1, Math.abs(values[col]))
    let forward: { values: number[]; distance: number } | undefined
    let backward: { values: number[]; distance: number } | undefined
    let domainError: unknown
    for (let attempt = 0; attempt < 16; attempt++) {
      const plus = [...values],
        minus = [...values]
      plus[col] += step
      minus[col] -= step
      const plusDistance = plus[col] - values[col]
      const minusDistance = values[col] - minus[col]
      let currentForward: typeof forward, currentBackward: typeof backward
      if (plusDistance > 0 && Number.isFinite(plus[col])) {
        try {
          currentForward = {
            values: evaluate(plus).residuals,
            distance: plusDistance,
          }
        } catch (error) {
          if (!(error instanceof ModelError)) throw error
          domainError = error
        }
      }
      if (minusDistance > 0 && Number.isFinite(minus[col])) {
        try {
          currentBackward = {
            values: evaluate(minus).residuals,
            distance: minusDistance,
          }
        } catch (error) {
          if (!(error instanceof ModelError)) throw error
          domainError = error
        }
      }
      if (currentForward) forward = currentForward
      if (currentBackward) backward = currentBackward
      if (currentForward && currentBackward) break
      step *= 0.25
    }
    if (!forward && !backward) {
      if (domainError instanceof ModelError) throw domainError
      throw new ModelError(
        '현재 추정값 주변에서 Jacobian을 계산할 수 없습니다. 초기 추정값과 함수의 정의역을 확인해 주세요.',
      )
    }
    for (let row = 0; row < n; row++) {
      const a = forward?.values[row] ?? base[row]
      const b = backward?.values[row] ?? base[row]
      const distance = (forward?.distance ?? 0) + (backward?.distance ?? 0)
      const difference = a - b
      const derivative = Number.isFinite(difference)
        ? difference / distance
        : a / distance - b / distance
      if (!Number.isFinite(derivative))
        throw new ModelError(
          'Jacobian의 기울기가 수치 범위를 벗어났습니다. 수식의 단위와 초기 추정값을 조정해 주세요.',
        )
      result[row][col] = derivative
    }
  }
  return result
}

function bisect(model: CompiledModel, evaluate: Evaluator): IterationResult {
  let left = model.bounds!.min,
    right = model.bounds!.max
  let leftEvaluation = evaluate([left]),
    rightEvaluation = evaluate([right])
  let leftResidual = leftEvaluation.residuals[0],
    rightResidual = rightEvaluation.residuals[0]
  if (leftResidual === 0)
    return { values: [left], evaluation: leftEvaluation, iterations: 0 }
  if (rightResidual === 0)
    return { values: [right], evaluation: rightEvaluation, iterations: 0 }
  if (Math.sign(leftResidual) === Math.sign(rightResidual))
    throw new ModelError(
      '구간 양 끝의 함수값 부호가 같습니다. 근을 사이에 두도록 최소·최대 경계를 조정해 주세요.',
    )
  // Use the better endpoint as the baseline: a very large value near a
  // different pole must not make a sign jump elsewhere look like a root.
  const residualScale = Math.min(
    Math.abs(leftResidual),
    Math.abs(rightResidual),
  )
  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    // Halving separately avoids overflow for large, opposite-signed bounds.
    const middle = left / 2 + right / 2
    const evaluation = evaluate([middle])
    const residual = evaluation.residuals[0]
    if (residual === 0)
      return { values: [middle], evaluation, iterations: iteration }
    const width = right / 2 - left / 2
    const narrow =
      width <= (BRACKET_TOLERANCE * Math.max(1, Math.abs(middle))) / 2
    // A narrow sign-changing bracket alone can be a pole or a jump. Require
    // an actual reduction in the function residual as well as a small width.
    if (narrow && Math.abs(residual) / residualScale <= RESIDUAL_TOLERANCE)
      return { values: [middle], evaluation, iterations: iteration }
    if (middle === left || middle === right)
      throw new ModelError(
        '구간이 수치 한계까지 줄었지만 잔차가 0에 가까워지지 않았습니다. 불연속점이나 근이 없는 구간인지 확인해 주세요.',
      )
    if (Math.sign(residual) === Math.sign(leftResidual)) {
      left = middle
      leftResidual = residual
      leftEvaluation = evaluation
    } else {
      right = middle
      rightResidual = residual
      rightEvaluation = evaluation
    }
  }
  throw new ModelError(
    '200회 반복 후에도 근에 수렴하지 않았습니다. 구간의 연속성과 최소·최대 경계를 확인해 주세요.',
  )
}

function newton(
  model: CompiledModel,
  evaluate: Evaluator,
  wasm: WasmExports | null,
): IterationResult {
  let values = [...model.guesses!]
  const variableScales = values.map((value) => Math.abs(value) || 1)
  const stepScale = (value: number, index: number) =>
    Math.max(Math.abs(value), variableScales[index] * 1e-6, 1e-300)
  let evaluation = evaluate(values)
  let matrix = jacobian(evaluate, values, evaluation.residuals)
  const rowScales = matrix.map((row, i) => {
    const gradientScale = Math.max(
      ...row.map((entry, j) => Math.abs(entry) * variableScales[j]),
    )
    return Math.max(
      Math.abs(evaluation.residuals[i]),
      gradientScale,
      Number.MIN_VALUE,
    )
  })
  const norm = (residuals: number[]) =>
    Math.max(...residuals.map((value, i) => Math.abs(value) / rowScales[i]))
  let lastStep = Infinity
  for (let iteration = 0; iteration <= MAX_ITERATIONS; iteration++) {
    const currentNorm = norm(evaluation.residuals)
    if (
      evaluation.residuals.every((value) => value === 0) ||
      (currentNorm <= RESIDUAL_TOLERANCE && lastStep <= STEP_TOLERANCE)
    ) {
      // Do not report an underdetermined system as a unique successful solve.
      linearStep(
        matrix,
        matrix.map(() => 0),
        wasm,
      )
      return { values, evaluation, iterations: iteration, matrix }
    }
    if (iteration === MAX_ITERATIONS) break
    const correction = linearStep(
      matrix,
      evaluation.residuals.map((value) => -value),
      wasm,
    )
    const correctionNorm = Math.max(
      ...correction.map(
        (value, i) => Math.abs(value) / stepScale(values[i], i),
      ),
    )
    if (currentNorm <= RESIDUAL_TOLERANCE && correctionNorm <= STEP_TOLERANCE)
      return { values, evaluation, iterations: iteration, matrix }
    let accepted:
      | { values: number[]; evaluation: Evaluation; alpha: number }
      | undefined
    let validCandidate = false
    let domainError: ModelError | undefined
    for (let search = 0, alpha = 1; search < 28; search++, alpha /= 2) {
      const candidate = values.map((value, i) => value + alpha * correction[i])
      if (!candidate.every(Number.isFinite)) continue
      try {
        const candidateEvaluation = evaluate(candidate)
        validCandidate = true
        const candidateNorm = norm(candidateEvaluation.residuals)
        if (
          candidateNorm <= currentNorm * (1 - 1e-4 * alpha) ||
          candidateEvaluation.residuals.every((value) => value === 0)
        ) {
          accepted = {
            values: candidate,
            evaluation: candidateEvaluation,
            alpha,
          }
          break
        }
      } catch (error) {
        if (!(error instanceof ModelError)) throw error
        domainError = error
      }
    }
    if (!accepted) {
      if (!validCandidate && domainError)
        throw new ModelError(
          `Newton 보정값이 함수의 정의역을 벗어났습니다. 초기 추정값을 조정해 주세요. ${domainError.message}`,
          domainError.line,
        )
      throw new ModelError(
        'Newton 반복이 더 이상 잔차를 줄이지 못해 수렴하지 않았습니다. 다른 초기 추정값과 수식의 연속성을 확인해 주세요.',
      )
    }
    lastStep = Math.max(
      ...accepted.values.map(
        (value, i) => Math.abs(value - values[i]) / stepScale(value, i),
      ),
    )
    values = accepted.values
    evaluation = accepted.evaluation
    matrix = jacobian(evaluate, values, evaluation.residuals)
    if (lastStep === 0 && norm(evaluation.residuals) > RESIDUAL_TOLERANCE)
      throw new ModelError(
        'Newton 보정량이 수치 한계에 도달했지만 잔차가 남았습니다. 초기 추정값과 수식의 단위를 확인해 주세요.',
      )
  }
  throw new ModelError(
    '200회 Newton 반복 후에도 수렴하지 않았습니다. 초기 추정값을 바꾸거나 수식의 정의역·스케일을 확인해 주세요.',
  )
}

/** Compile once per source/parameter schema, then solve with new values.
 * Scalar interval methods and expression evaluation run in JavaScript;
 * simultaneous Newton corrections use the actual WASM Gaussian kernel. */
export async function createNonlinearSolver(
  wasmBinary?: BufferSource,
): Promise<
  (
    source: string,
    parameters: Record<string, number>,
    options?: SolverOptions,
  ) => SolveResult
> {
  let wasm: WasmExports | null = null
  try {
    const bytes =
      wasmBinary ??
      (await (
        await fetch(`${import.meta.env?.BASE_URL ?? '/'}solver.wasm`)
      ).arrayBuffer())
    const instance = await WebAssembly.instantiate(bytes, {})
    const exports = instance.instance.exports as unknown as WasmExports
    if (
      !(exports.memory instanceof WebAssembly.Memory) ||
      typeof exports.solve !== 'function'
    )
      throw new Error('Missing solver exports')
    wasm = exports
  } catch {
    // A missing or blocked WASM module has an explicitly labelled fallback.
  }
  return (source, parameters, options = {}) => {
    const start = performance.now()
    const conditionNorm = options.conditionNorm ?? 'infinity'
    if (conditionNorm !== 'infinity' && conditionNorm !== '2')
      throw new ModelError('조건수 계산 방법을 확인해 주세요.')
    const model = compileNonlinear(source, Object.keys(parameters))
    const evaluate: Evaluator = (values) => model.evaluate(values, parameters)
    if (model.kind === 'evaluation') {
      const evaluation = evaluate([])
      return {
        kind: 'evaluation',
        variables: evaluation.evaluationNames,
        values: evaluation.evaluationValues,
        auxiliary: evaluation.auxiliary,
        matrix: [],
        rhs: [],
        residuals: [],
        maxResidual: 0,
        condition: NaN,
        conditionNorm,
        conditionError:
          '수식 평가에는 근 찾기와 Jacobian 조건수가 적용되지 않습니다.',
        engine: 'javascript',
        iterations: 0,
        method: '명시적 수식 평가',
        durationMs: performance.now() - start,
        warnings: [],
      }
    }
    const scalar = model.variables.length === 1
    let solved: IterationResult
    let matrix: number[][]
    try {
      solved = scalar ? bisect(model, evaluate) : newton(model, evaluate, wasm)
      matrix =
        solved.matrix ??
        jacobian(evaluate, solved.values, solved.evaluation.residuals)
    } catch (error) {
      if (error instanceof ModelError && error.line === undefined)
        error.line = model.rootLines?.[0]
      throw error
    }
    const residuals = solved.evaluation.residuals
    let condition = NaN
    let conditionError: string | undefined
    if (options.computeCondition !== false) {
      try {
        condition = conditionNumber(matrix, conditionNorm)
      } catch {
        conditionError =
          '선택한 방법으로 해에서의 Jacobian 조건수를 계산하지 못했습니다. 잔차와 다른 norm을 확인해 주세요.'
      }
    }
    const warnings: string[] = []
    if (!scalar && !wasm)
      warnings.push(
        'WebAssembly를 사용할 수 없어 JavaScript Newton 솔버로 계산했습니다.',
      )
    if (conditionError) warnings.push(conditionError)
    if (condition >= 1e8)
      warnings.push(
        '해에서의 Jacobian 조건수가 큽니다. 초기 추정값과 입력 오차에 대한 민감도를 확인해 주세요.',
      )
    warnings.push(
      scalar
        ? '지정 구간에서 찾은 하나의 근입니다. 모든 근을 보장하지 않으며 다른 구간에서는 다른 근을 찾을 수 있습니다.'
        : '초기 추정값에서 찾은 하나의 해입니다. 다른 초기 추정값에서는 다른 해를 찾거나 수렴하지 않을 수 있습니다.',
    )
    return {
      kind: 'nonlinear',
      variables: model.variables,
      values: solved.values,
      auxiliary: solved.evaluation.auxiliary,
      matrix,
      rhs: residuals.map((value) => -value),
      residuals,
      maxResidual: Math.max(...residuals.map(Math.abs)),
      condition,
      conditionNorm,
      ...(conditionError ? { conditionError } : {}),
      engine: !scalar && wasm ? 'wasm' : 'javascript',
      iterations: solved.iterations,
      method: scalar ? '구간 이분법' : '감쇠 Newton · 수치 Jacobian',
      durationMs: performance.now() - start,
      warnings,
    }
  }
}
