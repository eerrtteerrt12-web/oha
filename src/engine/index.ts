import { conditionNumber, type ConditionNorm } from './conditioning'
export {
  classifyCondition,
  CONDITION_THRESHOLDS,
  conditionNumber,
} from './conditioning'
export type { ConditionNorm, ConditionAssessment } from './conditioning'

export type SolverOptions = {
  conditionNorm?: ConditionNorm
  computeCondition?: boolean
}

export type Parameter = {
  id: string
  name: string
  value: number
  min: number
  max: number
  step: number
}
export type ModelInput = { source: string; parameters: Record<string, number> }
export type SolveResult = {
  kind?: 'linear' | 'nonlinear' | 'evaluation'
  iterations?: number
  method?: string
  auxiliary?: Record<string, number>
  variables: string[]
  values: number[]
  matrix: number[][]
  rhs: number[]
  residuals: number[]
  maxResidual: number
  condition: number
  conditionNorm: ConditionNorm
  conditionError?: string
  engine: 'wasm' | 'javascript'
  durationMs: number
  warnings: string[]
}
export type SweepPoint = {
  parameter: number
  values: number[] | null
  error?: string
}
export type SearchSummary = {
  method: string
  min: number
  max: number
  attempts: number
  note: string
  truncated?: boolean
}
export type SimulationAnchor = {
  id: string
  label: string
  variables: string[]
  values: number[]
  parameters: Record<string, number>
}
export type SimulationPanel = {
  id: string
  label: string
  result: SolveResult | null
  error?: string
  sweep: SweepPoint[]
  dataset: SweepPoint[]
  datasetError?: string
  sweepName: string
}
export type SolvePayload = {
  simulations?: SimulationPanel[]
  solutions?: SolveResult[]
  selectedSolution?: number
  search?: SearchSummary
  result: SolveResult
  sweep: SweepPoint[]
  dataset: SweepPoint[]
  datasetError?: string
  sweepName: string
}
export class ModelError extends Error {
  line?: number
  constructor(message: string, line?: number) {
    super(message)
    this.name = 'ModelError'
    this.line = line
  }
}
type Node =
  | { kind: 'number'; value: number }
  | { kind: 'name'; name: string }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'negative'; child: Node }
type Token = { text: string; kind: 'number' | 'name' | 'operator' }
type Equation = { left: Node; right: Node; line: number }
type Compiled = { equations: Equation[]; names: string[] }
type Affine = { constant: number; coefficients: Map<string, number> }
const MAX_VARIABLES = 64
const RESERVED = new Set([
  'sin',
  'cos',
  'tan',
  'exp',
  'log',
  'ln',
  'sqrt',
  'abs',
  'if',
  'then',
  'else',
  'and',
  'or',
])
const cache = new Map<string, Compiled>()

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let position = 0
  while (position < source.length) {
    if (/\s/.test(source[position])) {
      position++
      continue
    }
    const rest = source.slice(position)
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)
    if (number) {
      if (!Number.isFinite(Number(number[0])))
        throw new ModelError('숫자가 너무 큽니다. 유한한 값을 입력해 주세요.')
      tokens.push({ text: number[0], kind: 'number' })
      position += number[0].length
      continue
    }
    const name = rest.match(/^[A-Za-z][A-Za-z0-9_]*/)
    if (name) {
      if (RESERVED.has(name[0].toLowerCase()))
        throw new ModelError(
          `'${name[0]}'은 예약어입니다. 선형식에는 함수 대신 다른 변수 이름을 사용해 주세요.`,
        )
      tokens.push({ text: name[0], kind: 'name' })
      position += name[0].length
      continue
    }
    if ('+-*/^()'.includes(source[position])) {
      tokens.push({ text: source[position++], kind: 'operator' })
      continue
    }
    throw new ModelError(
      `'${source[position]}' 문자를 이해할 수 없습니다. 영문 변수 이름과 수학 연산자를 사용해 주세요.`,
    )
  }
  if (tokens.length > 2000)
    throw new ModelError(
      '한 수식이 너무 깁니다. 여러 개의 짧은 수식으로 나눠 주세요.',
    )
  return tokens
}
function parseExpression(source: string, names: Set<string>): Node {
  const tokens = tokenize(source)
  let index = 0,
    depth = 0
  const at = (text: string) => tokens[index]?.text === text
  function expression(): Node {
    let node = product()
    while (at('+') || at('-')) {
      const op = tokens[index++].text
      node = { kind: 'binary', op, left: node, right: product() }
    }
    return node
  }
  function product(): Node {
    let node = unary()
    while (
      at('*') ||
      at('/') ||
      (tokens[index]?.kind === 'name' && tokens[index - 1]?.kind === 'number')
    ) {
      const implicit = tokens[index]?.kind === 'name'
      const op = implicit ? '*' : tokens[index++].text
      node = { kind: 'binary', op, left: node, right: unary() }
    }
    return node
  }
  function unary(): Node {
    if (++depth > 80)
      throw new ModelError(
        '수식의 중첩이 너무 깊습니다. 괄호와 부호를 줄여 주세요.',
      )
    let node: Node
    if (at('+')) {
      index++
      node = unary()
    } else if (at('-')) {
      index++
      node = { kind: 'negative', child: unary() }
    } else {
      const token = tokens[index++]
      if (!token)
        throw new ModelError(
          '수식이 완성되지 않았습니다. 연산자 뒤에 숫자나 변수를 입력해 주세요.',
        )
      if (token.kind === 'number')
        node = { kind: 'number', value: Number(token.text) }
      else if (token.kind === 'name') {
        names.add(token.text)
        node = { kind: 'name', name: token.text }
      } else if (token.text === '(') {
        node = expression()
        if (!at(')')) throw new ModelError('닫는 괄호 )가 필요합니다.')
        index++
      } else
        throw new ModelError(`'${token.text}' 앞뒤의 수식을 확인해 주세요.`)
      if (at('^')) {
        index++
        node = { kind: 'binary', op: '^', left: node, right: unary() }
      }
    }
    depth--
    return node
  }
  const result = expression()
  if (index !== tokens.length)
    throw new ModelError(
      `'${tokens[index].text}' 앞에 연산자가 필요합니다. 곱셈은 * 또는 2x처럼 입력해 주세요.`,
    )
  return result
}
export function compileModel(source: string): Compiled {
  const existing = cache.get(source)
  if (existing) return existing
  if (source.length > 30000)
    throw new ModelError('모델이 너무 큽니다. 30,000자 이내로 입력해 주세요.')
  const names = new Set<string>(),
    equations: Equation[] = []
  source.split(/\r?\n/).forEach((raw, i) => {
    const text = raw.split('#')[0].trim()
    if (!text) return
    const sides = text.split('=')
    if (sides.length !== 2 || !sides[0].trim() || !sides[1].trim())
      throw new ModelError(
        '한 줄에 완성된 등식 하나를 입력해 주세요. 예: 2x + y = 10',
        i + 1,
      )
    try {
      equations.push({
        left: parseExpression(sides[0], names),
        right: parseExpression(sides[1], names),
        line: i + 1,
      })
    } catch (error) {
      if (error instanceof ModelError) error.line = i + 1
      throw error
    }
  })
  if (!equations.length)
    throw new ModelError('먼저 수식을 입력해 주세요. 예: 2x + y = 10')
  if (equations.length > MAX_VARIABLES)
    throw new ModelError(
      `프로토타입은 최대 ${MAX_VARIABLES}개의 수식을 지원합니다.`,
    )
  const result = { equations, names: [...names] }
  if (cache.size >= 16) cache.delete(cache.keys().next().value!)
  cache.set(source, result)
  return result
}
function scale(a: Affine, multiplier: number): Affine {
  return {
    constant: a.constant * multiplier,
    coefficients: new Map(
      [...a.coefficients].map(([name, value]) => [name, value * multiplier]),
    ),
  }
}
function add(a: Affine, b: Affine, sign = 1): Affine {
  const coefficients = new Map(a.coefficients)
  for (const [name, value] of b.coefficients)
    coefficients.set(name, (coefficients.get(name) ?? 0) + value * sign)
  return { constant: a.constant + b.constant * sign, coefficients }
}
const hasUnknown = (a: Affine) =>
  [...a.coefficients.values()].some((value) => value !== 0)
function evaluate(node: Node, parameters: Record<string, number>): Affine {
  if (node.kind === 'number')
    return { constant: node.value, coefficients: new Map() }
  if (node.kind === 'name')
    return Object.hasOwn(parameters, node.name)
      ? { constant: parameters[node.name], coefficients: new Map() }
      : { constant: 0, coefficients: new Map([[node.name, 1]]) }
  if (node.kind === 'negative')
    return scale(evaluate(node.child, parameters), -1)
  const a = evaluate(node.left, parameters),
    b = evaluate(node.right, parameters)
  if (node.op === '+') return add(a, b)
  if (node.op === '-') return add(a, b, -1)
  if (node.op === '*') {
    if (hasUnknown(a) && hasUnknown(b))
      throw new ModelError(
        '미지수끼리의 곱은 선형식이 아닙니다. 계수는 파라미터로 등록하고, 미지수는 1차로 입력해 주세요.',
      )
    return hasUnknown(a) ? scale(a, b.constant) : scale(b, a.constant)
  }
  if (node.op === '/') {
    if (hasUnknown(b))
      throw new ModelError(
        '미지수로 나눌 수 없습니다. 선형식의 분모는 숫자 또는 파라미터여야 합니다.',
      )
    if (b.constant === 0)
      throw new ModelError(
        '0으로 나눌 수 없습니다. 분모에 사용한 파라미터를 확인해 주세요.',
      )
    return scale(a, 1 / b.constant)
  }
  if (hasUnknown(b))
    throw new ModelError('지수에는 미지수를 사용할 수 없습니다.')
  if (hasUnknown(a)) {
    if (b.constant === 1) return a
    if (b.constant === 0) return { constant: 1, coefficients: new Map() }
    throw new ModelError(
      '미지수의 거듭제곱은 선형식이 아닙니다. 미지수는 1차로 입력해 주세요.',
    )
  }
  return { constant: a.constant ** b.constant, coefficients: new Map() }
}
function assemble(source: string, parameters: Record<string, number>) {
  for (const [name, value] of Object.entries(parameters)) {
    if (
      !/^[A-Za-z][A-Za-z0-9_]*$/.test(name) ||
      RESERVED.has(name.toLowerCase())
    )
      throw new ModelError(`파라미터 이름 '${name}'을 확인해 주세요.`)
    if (!Number.isFinite(value))
      throw new ModelError(`파라미터 '${name}'에 유한한 숫자를 입력해 주세요.`)
  }
  const compiled = compileModel(source)
  const variables = compiled.names.filter(
    (name) => !Object.hasOwn(parameters, name),
  )
  if (!variables.length)
    throw new ModelError(
      '구할 미지수가 없습니다. 파라미터에 등록하지 않은 변수 이름을 수식에 넣어 주세요.',
    )
  if (variables.length !== compiled.equations.length)
    throw new ModelError(
      `수식 ${compiled.equations.length}개와 미지수 ${variables.length}개가 일치해야 합니다. 알려진 값은 파라미터에 등록해 주세요.`,
    )
  const matrix: number[][] = [],
    rhs: number[] = []
  for (const equation of compiled.equations) {
    try {
      const row = add(
        evaluate(equation.left, parameters),
        evaluate(equation.right, parameters),
        -1,
      )
      const coefficients = variables.map(
        (name) => row.coefficients.get(name) ?? 0,
      )
      if (![...coefficients, row.constant].every(Number.isFinite))
        throw new ModelError(
          '계산 중 유한하지 않은 값이 발생했습니다. 계수와 파라미터 범위를 확인해 주세요.',
        )
      matrix.push(coefficients)
      rhs.push(-row.constant)
    } catch (error) {
      if (error instanceof ModelError) error.line = equation.line
      throw error
    }
  }
  return { variables, matrix, rhs }
}
const EPSILON = 1e-12
/** Row equilibration protects systems whose equations use very different units. */
function normalize(matrix: number[][], rhs: number[]) {
  return matrix.map((row, i) => {
    const magnitude = Math.max(...row.map(Math.abs)) || 1
    return [...row.map((value) => value / magnitude), rhs[i] / magnitude]
  })
}
function singularError(augmented: number[][]): never {
  const n = augmented.length,
    rows = augmented.map((row) => [...row])
  let rank = 0
  for (let col = 0; col < n && rank < n; col++) {
    let pivot = rank
    for (let row = rank + 1; row < n; row++)
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row
    if (Math.abs(rows[pivot][col]) < EPSILON) continue
    ;[rows[rank], rows[pivot]] = [rows[pivot], rows[rank]]
    for (let row = rank + 1; row < n; row++) {
      const factor = rows[row][col] / rows[rank][col]
      for (let c = col; c <= n; c++) rows[row][c] -= factor * rows[rank][c]
    }
    rank++
  }
  const inconsistent = rows.some(
    (row) =>
      row.slice(0, n).every((value) => Math.abs(value) < EPSILON) &&
      Math.abs(row[n]) >= EPSILON,
  )
  throw new ModelError(
    inconsistent
      ? '서로 모순되는 수식으로 해가 없습니다. 우변과 파라미터를 확인해 주세요.'
      : '독립적인 수식이 부족하거나 행렬이 수치적으로 특이합니다. 중복 수식과 계수를 확인해 주세요.',
  )
}
function solveJavascript(augmented: number[][]): number[] {
  const a = augmented.map((row) => [...row]),
    n = a.length
  for (let k = 0; k < n; k++) {
    let pivot = k
    for (let row = k + 1; row < n; row++)
      if (Math.abs(a[row][k]) > Math.abs(a[pivot][k])) pivot = row
    if (Math.abs(a[pivot][k]) < EPSILON) singularError(augmented)
    ;[a[k], a[pivot]] = [a[pivot], a[k]]
    for (let row = k + 1; row < n; row++) {
      const factor = a[row][k] / a[k][k]
      for (let col = k + 1; col <= n; col++) a[row][col] -= factor * a[k][col]
      a[row][k] = 0
    }
  }
  const values = Array<number>(n).fill(0)
  for (let row = n - 1; row >= 0; row--) {
    let value = a[row][n]
    for (let col = row + 1; col < n; col++) value -= a[row][col] * values[col]
    values[row] = value / a[row][row]
  }
  return values
}
type WasmExports = { memory: WebAssembly.Memory; solve: (n: number) => number }
export async function createSolver(
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
    wasm = instance.instance.exports as unknown as WasmExports
  } catch {
    /* Offline browser constraints can use the same pivoted algorithm in JavaScript. */
  }
  return (source, parameters, options = {}) => {
    const start = performance.now()
    const conditionNorm = options.conditionNorm ?? 'infinity'
    if (conditionNorm !== 'infinity' && conditionNorm !== '2')
      throw new ModelError('조건수 계산 방법을 확인해 주세요.')
    const { variables, matrix, rhs } = assemble(source, parameters)
    const augmented = normalize(matrix, rhs)
    let values: number[]
    if (wasm) {
      const memory = new Float64Array(wasm.memory.buffer)
      memory.set(augmented.flat(), 0)
      if (wasm.solve(variables.length) !== 0) singularError(augmented)
      values = Array.from(
        new Float64Array(wasm.memory.buffer, 65536, variables.length),
      )
    } else values = solveJavascript(augmented)
    if (!values.every(Number.isFinite))
      throw new ModelError(
        '수치 범위를 벗어났습니다. 계수의 크기와 단위를 조정해 주세요.',
      )
    // Accumulate in scaled coordinates so finite solutions such as 1e308*2
    // do not produce Infinity - Infinity and a misleading NaN diagnostic.
    const valueMagnitude = Math.max(1, ...values.map(Math.abs))
    const residuals = matrix.map((row, i) => {
      const magnitude = Math.max(...row.map(Math.abs)) || 1
      let sum = -(rhs[i] / magnitude / valueMagnitude),
        compensation = 0
      for (let col = 0; col < row.length; col++) {
        const term =
          (row[col] / magnitude) * (values[col] / valueMagnitude) - compensation
        const next = sum + term
        compensation = next - sum - term
        sum = next
      }
      return sum * magnitude * valueMagnitude
    })
    const maxResidual = Math.max(...residuals.map(Math.abs))
    // Sweeps need solution values only; avoid thousands of unused SVD/inverse
    // diagnostics. Their NaN condition is internal and never shown as a result.
    let condition = NaN
    let conditionError: string | undefined
    if (options.computeCondition !== false) {
      try {
        condition = conditionNumber(matrix, conditionNorm)
      } catch {
        conditionError =
          '선택한 방법으로 조건수를 계산하지 못했습니다. 해와 잔차를 별도로 확인하거나 다른 norm을 선택해 주세요.'
      }
    }
    const warnings: string[] = []
    if (conditionError) warnings.push(conditionError)
    if (!wasm)
      warnings.push(
        'WebAssembly를 사용할 수 없어 JavaScript 솔버로 계산했습니다.',
      )
    if (condition >= 1e8)
      warnings.push(
        '조건수가 큽니다. 입력값의 작은 변화가 해에 큰 영향을 줄 수 있습니다.',
      )
    const scale = Math.max(1, ...rhs.map(Math.abs))
    if (maxResidual > 1e-8 * scale)
      warnings.push(
        '수치 잔차가 큽니다. 결과의 정밀도와 입력 단위를 확인해 주세요.',
      )
    return {
      variables,
      values,
      matrix,
      rhs,
      residuals,
      maxResidual,
      condition,
      conditionNorm,
      ...(conditionError ? { conditionError } : {}),
      engine: wasm ? 'wasm' : 'javascript',
      durationMs: performance.now() - start,
      warnings,
    }
  }
}
