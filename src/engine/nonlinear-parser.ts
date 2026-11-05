import { ModelError } from './index'

type Node =
  | { kind: 'number'; value: number }
  | { kind: 'name'; name: string }
  | { kind: 'unary'; sign: '+' | '-'; child: Node }
  | { kind: 'binary'; operator: string; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] }
type Expression = { node: Node; line: number; references: Set<string> }
type Definition = Expression & { name: string }
type Condition = {
  name: string
  type: 'min' | 'max' | '0'
  value: number
  line: number
}
type Token = { text: string; type: 'number' | 'name' | 'operator' }

export type NonlinearEvaluation = {
  residuals: number[]
  auxiliary: Record<string, number>
  evaluationNames: string[]
  evaluationValues: number[]
}

export type CompiledModel = {
  variables: string[]
  rootLines?: number[]
  kind: 'nonlinear' | 'evaluation'
  bounds?: { min: number; max: number }
  guesses?: number[]
  evaluate(
    values: number[],
    parameters: Record<string, number>,
  ): NonlinearEvaluation
}

// Functions operate on real values. ln is natural logarithm; log/log10 are base 10.
const FUNCTIONS: Record<
  string,
  { arity: number; compute: (...args: number[]) => number }
> = {
  sin: { arity: 1, compute: Math.sin },
  cos: { arity: 1, compute: Math.cos },
  tan: { arity: 1, compute: Math.tan },
  asin: { arity: 1, compute: Math.asin },
  acos: { arity: 1, compute: Math.acos },
  atan: { arity: 1, compute: Math.atan },
  sinh: { arity: 1, compute: Math.sinh },
  cosh: { arity: 1, compute: Math.cosh },
  tanh: { arity: 1, compute: Math.tanh },
  exp: { arity: 1, compute: Math.exp },
  ln: { arity: 1, compute: Math.log },
  log: { arity: 1, compute: Math.log10 },
  log10: { arity: 1, compute: Math.log10 },
  sqrt: { arity: 1, compute: Math.sqrt },
  abs: { arity: 1, compute: Math.abs },
  pow: { arity: 2, compute: Math.pow },
  min: { arity: 2, compute: Math.min },
  max: { arity: 2, compute: Math.max },
}
const BUILTINS = new Map([
  ['pi', Math.PI],
  ['e', Math.E],
])
const RESERVED = new Set([
  ...Object.keys(FUNCTIONS),
  ...BUILTINS.keys(),
  'if',
  'then',
  'else',
  'and',
  'or',
])
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
const cache = new Map<string, CompiledModel>()

function assertName(name: string, line?: number) {
  if (!NAME.test(name) || RESERVED.has(name)) {
    throw new ModelError(
      `변수 이름 '${name}'을 사용할 수 없습니다. 영문자로 시작하는 이름을 사용하고 함수 이름은 피하세요.`,
      line,
    )
  }
}

function parseExpression(source: string, line: number): Expression {
  const tokens: Token[] = []
  for (let position = 0; position < source.length; ) {
    const rest = source.slice(position)
    const space = /^\s+/.exec(rest)
    if (space) {
      position += space[0].length
      continue
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest)
    const name = /^[A-Za-z][A-Za-z0-9_]*/.exec(rest)
    if (number) {
      if (!Number.isFinite(Number(number[0])))
        throw new ModelError('유한한 숫자를 입력하세요.', line)
      tokens.push({ text: number[0], type: 'number' })
      position += number[0].length
    } else if (name) {
      tokens.push({ text: name[0], type: 'name' })
      position += name[0].length
    } else if ('+-*/^(),'.includes(rest[0])) {
      tokens.push({ text: rest[0], type: 'operator' })
      position += 1
    } else
      throw new ModelError(
        `수식에 사용할 수 없는 문자 '${rest[0]}'입니다.`,
        line,
      )
    if (tokens.length > 2048)
      throw new ModelError(
        '한 수식은 2,048개 이하의 토큰으로 작성하세요.',
        line,
      )
  }
  if (!tokens.length)
    throw new ModelError('등호 오른쪽에 수식을 입력하세요.', line)
  let position = 0
  let depth = 0
  const references = new Set<string>()
  const peek = () => tokens[position]?.text
  const nested = <T>(run: () => T): T => {
    depth += 1
    if (depth > 96)
      throw new ModelError(
        '수식의 괄호 또는 지수가 너무 깊게 중첩되었습니다.',
        line,
      )
    try {
      return run()
    } finally {
      depth -= 1
    }
  }
  const atom = (): Node =>
    nested(() => {
      const token = tokens[position++]
      if (!token) throw new ModelError('수식이 완성되지 않았습니다.', line)
      if (token.type === 'number')
        return { kind: 'number', value: Number(token.text) }
      if (token.text === '(') {
        const node = additive()
        if (peek() !== ')')
          throw new ModelError('닫는 괄호 )가 필요합니다.', line)
        position += 1
        return node
      }
      if (token.type === 'name') {
        if (peek() === '(') {
          const fn = Object.hasOwn(FUNCTIONS, token.text)
            ? FUNCTIONS[token.text]
            : undefined
          if (!fn)
            throw new ModelError(
              `지원하지 않는 함수 '${token.text}'입니다. 곱셈은 *로 표시하세요.`,
              line,
            )
          position += 1
          const args = [additive()]
          while (peek() === ',') {
            position += 1
            args.push(additive())
          }
          if (peek() !== ')')
            throw new ModelError(
              `함수 ${token.text}의 닫는 괄호 )가 필요합니다.`,
              line,
            )
          position += 1
          if (args.length !== fn.arity)
            throw new ModelError(
              `${token.text} 함수에는 ${fn.arity}개의 인수가 필요합니다.`,
              line,
            )
          return { kind: 'call', name: token.text, args }
        }
        references.add(token.text)
        return { kind: 'name', name: token.text }
      }
      throw new ModelError(
        `'${token.text}' 앞에 값이나 변수가 필요합니다.`,
        line,
      )
    })
  // A power's right operand may itself be signed or a power. A leading minus
  // is outside that power, so -x^2 and 2^-2 have their usual mathematical meaning.
  const power = (): Node =>
    nested(() => {
      const left = atom()
      if (peek() !== '^') return left
      position += 1
      return { kind: 'binary', operator: '^', left, right: unary() }
    })
  const unary = (): Node =>
    nested(() => {
      const sign = peek()
      if (sign !== '+' && sign !== '-') return power()
      position += 1
      return { kind: 'unary', sign, child: unary() }
    })
  const product = (): Node => {
    let node = unary()
    for (;;) {
      const operator = peek()
      if (operator === '*' || operator === '/') {
        position += 1
        node = { kind: 'binary', operator, left: node, right: unary() }
        continue
      }
      const previous = tokens[position - 1]
      // Support 2x, 2(x + 1), and (x + 1)(x - 1). Named calls remain unambiguous.
      const implied =
        (previous?.type === 'number' || previous?.text === ')') &&
        (tokens[position]?.type === 'name' || operator === '(')
      if (!implied) return node
      node = { kind: 'binary', operator: '*', left: node, right: unary() }
    }
  }
  const additive = (): Node => {
    let node = product()
    while (peek() === '+' || peek() === '-') {
      const operator = tokens[position++].text
      node = { kind: 'binary', operator, left: node, right: product() }
    }
    return node
  }
  const node = additive()
  if (position !== tokens.length)
    throw new ModelError(`'${peek()}' 앞에 연산자가 필요합니다.`, line)
  return { node, line, references }
}

function evaluateExpression(
  expression: Expression,
  environment: Map<string, number>,
): number {
  function evaluate(node: Node): number {
    let value: number
    switch (node.kind) {
      case 'number':
        return node.value
      case 'name': {
        const entry = environment.get(node.name)
        if (entry === undefined)
          throw new ModelError(
            `정의되지 않은 변수 '${node.name}'입니다.`,
            expression.line,
          )
        return entry
      }
      case 'unary':
        value = (node.sign === '-' ? -1 : 1) * evaluate(node.child)
        break
      case 'call':
        value = FUNCTIONS[node.name].compute(...node.args.map(evaluate))
        break
      case 'binary': {
        const left = evaluate(node.left),
          right = evaluate(node.right)
        if (node.operator === '+') value = left + right
        else if (node.operator === '-') value = left - right
        else if (node.operator === '*') value = left * right
        else if (node.operator === '/') value = left / right
        else value = left ** right
        break
      }
    }
    if (!Number.isFinite(value))
      throw new ModelError(
        '수식의 계산값이 실수 범위를 벗어났습니다. 0으로 나누기, 로그·제곱근의 정의역과 오버플로를 확인하세요.',
        expression.line,
      )
    return value
  }
  return evaluate(expression.node)
}

/** Parse once and evaluate repeatedly with new root values or external parameters. */
export function compileNonlinear(
  source: string,
  parameterNames: string[],
): CompiledModel {
  if (source.length > 30_000)
    throw new ModelError('수식은 30,000자 이내로 입력하세요.')
  const parameters = [...parameterNames].sort()
  for (const name of parameters) assertName(name)
  if (new Set(parameters).size !== parameters.length)
    throw new ModelError('파라미터 이름은 서로 달라야 합니다.')
  const key = JSON.stringify([source, parameters])
  const cached = cache.get(key)
  if (cached) return cached
  const roots: Definition[] = [],
    assignments: Definition[] = [],
    anonymous: Expression[] = [],
    conditions: Condition[] = []
  const declared = new Map<string, number>()
  const declare = (name: string, line: number) => {
    assertName(name, line)
    if (declared.has(name))
      throw new ModelError(
        `변수 '${name}'이 중복 정의되었습니다. 근 변수와 명시적 변수는 다른 이름을 사용하세요.`,
        line,
      )
    if (parameters.includes(name))
      throw new ModelError(
        `파라미터 '${name}'은 이미 파라미터 패널에 정의되어 있습니다.`,
        line,
      )
    declared.set(name, line)
  }
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = index + 1
    if (/^\s*#@/.test(lines[index]))
      throw new ModelError(
        '해법 지정 지시문과 제약 초기값은 아직 지원하지 않습니다. 일반 초기값을 사용하세요.',
        line,
      )
    const text = lines[index].split('#', 1)[0].trim()
    if (!text) continue
    if (
      text.includes('>=') ||
      text.includes('<=') ||
      text.includes('>') ||
      text.includes('<')
    )
      throw new ModelError(
        '제약 초기값과 부등식은 아직 지원하지 않습니다.',
        line,
      )
    const equals = text.split('=')
    if (equals.length > 2)
      throw new ModelError(
        '한 줄에는 등호를 하나만 사용하세요. f(x) 오른쪽에는 0이 될 잔차식만 작성합니다.',
        line,
      )
    if (equals.length === 1) {
      anonymous.push(parseExpression(text, line))
      continue
    }
    const left = equals[0].trim(),
      right = equals[1].trim()
    const root = /^f\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)$/.exec(left)
    const condition = /^([A-Za-z][A-Za-z0-9_]*)\(\s*(min|max|0)\s*\)$/.exec(
      left,
    )
    if (root) {
      declare(root[1], line)
      roots.push({ name: root[1], ...parseExpression(right, line) })
      if (roots.length > 16)
        throw new ModelError(
          '비선형 근 변수는 최대 16개까지 사용할 수 있습니다.',
          line,
        )
    } else if (condition) {
      if (!NUMBER.test(right) || !Number.isFinite(Number(right)))
        throw new ModelError(
          '경계와 초기값에는 수식 대신 유한한 숫자를 직접 입력하세요.',
          line,
        )
      conditions.push({
        name: condition[1],
        type: condition[2] as Condition['type'],
        value: Number(right),
        line,
      })
    } else if (NAME.test(left)) {
      declare(left, line)
      assignments.push({ name: left, ...parseExpression(right, line) })
    } else
      throw new ModelError(
        'f(x)=잔차식, 이름=수식, x(min)/x(max) 또는 x(0) 형식으로 작성하세요.',
        line,
      )
  }
  if (!roots.length && !assignments.length && !anonymous.length)
    throw new ModelError('계산할 수식을 입력하세요.')
  if (roots.length && anonymous.length)
    throw new ModelError(
      '근을 구하는 모델에서는 익명 수식을 사용할 수 없습니다. 이름=수식으로 정의하세요.',
      anonymous[0].line,
    )
  const available = new Set([
    ...declared.keys(),
    ...parameters,
    ...BUILTINS.keys(),
  ])
  for (const expression of [...roots, ...assignments, ...anonymous]) {
    for (const reference of expression.references)
      if (!available.has(reference))
        throw new ModelError(
          `정의되지 않은 변수 '${reference}'입니다.`,
          expression.line,
        )
  }
  const byName = new Map(
    assignments.map((assignment) => [assignment.name, assignment]),
  )
  const remaining = new Map<string, number>()
  const dependents = new Map<string, Definition[]>()
  for (const assignment of assignments) {
    const dependencies = [...assignment.references].filter((name) =>
      byName.has(name),
    )
    remaining.set(assignment.name, dependencies.length)
    for (const dependency of dependencies) {
      const list = dependents.get(dependency) ?? []
      list.push(assignment)
      dependents.set(dependency, list)
    }
  }
  // Iterative topological ordering also handles long helper chains without
  // consuming the JavaScript call stack during compilation.
  const sorted = assignments.filter(
    (assignment) => remaining.get(assignment.name) === 0,
  )
  for (let index = 0; index < sorted.length; index += 1) {
    for (const dependent of dependents.get(sorted[index].name) ?? []) {
      const count = remaining.get(dependent.name)! - 1
      remaining.set(dependent.name, count)
      if (count === 0) sorted.push(dependent)
    }
  }
  if (sorted.length !== assignments.length) {
    const cyclic = assignments.find(
      (assignment) => remaining.get(assignment.name)! > 0,
    )!
    throw new ModelError(
      `명시적 변수 '${cyclic.name}'에 순환 참조가 있습니다.`,
      cyclic.line,
    )
  }
  const variables = roots.map((root) => root.name)
  let bounds: CompiledModel['bounds'], guesses: CompiledModel['guesses']
  const conditionKeys = new Set<string>()
  for (const condition of conditions) {
    if (!variables.includes(condition.name))
      throw new ModelError(
        `조건의 변수 '${condition.name}'에 대응하는 f(${condition.name})가 없습니다.`,
        condition.line,
      )
    const conditionKey = `${condition.name}:${condition.type}`
    if (conditionKeys.has(conditionKey))
      throw new ModelError(
        `'${condition.name}(${condition.type})' 조건이 중복되었습니다.`,
        condition.line,
      )
    conditionKeys.add(conditionKey)
    if ((roots.length === 1) !== (condition.type !== '0'))
      throw new ModelError(
        roots.length === 1
          ? '하나의 근에는 초기값 대신 (min), (max) 경계가 필요합니다.'
          : '연립 비선형식에는 경계 대신 각 변수의 (0) 초기값이 필요합니다.',
        condition.line,
      )
  }
  if (roots.length === 1) {
    const min = conditions.find((condition) => condition.type === 'min')
    const max = conditions.find((condition) => condition.type === 'max')
    if (!min || !max)
      throw new ModelError(
        `${variables[0]}(min)과 ${variables[0]}(max) 경계를 모두 입력하세요.`,
        roots[0].line,
      )
    if (min.value >= max.value)
      throw new ModelError('최소 경계는 최대 경계보다 작아야 합니다.', max.line)
    bounds = { min: min.value, max: max.value }
  } else if (roots.length > 1) {
    guesses = roots.map((root) => {
      const guess = conditions.find(
        (condition) => condition.name === root.name && condition.type === '0',
      )
      if (!guess)
        throw new ModelError(`${root.name}(0) 초기값을 입력하세요.`, root.line)
      return guess.value
    })
  }
  let anonymousIndex = 1
  const anonymousNames = anonymous.map(() => {
    while (available.has(`result_${anonymousIndex}`)) anonymousIndex += 1
    return `result_${anonymousIndex++}`
  })
  const compiled: CompiledModel = {
    variables,
    rootLines: roots.map((root) => root.line),
    kind: roots.length ? 'nonlinear' : 'evaluation',
    bounds,
    guesses,
    evaluate(values, parameterValues) {
      if (values.length !== roots.length || !values.every(Number.isFinite))
        throw new ModelError(
          '근 변수의 값이 유한하지 않거나 변수 개수와 맞지 않습니다.',
        )
      const environment = new Map(BUILTINS)
      for (const name of parameters) {
        const value = Object.hasOwn(parameterValues, name)
          ? parameterValues[name]
          : undefined
        if (typeof value !== 'number' || !Number.isFinite(value))
          throw new ModelError(`파라미터 '${name}'에 유한한 숫자가 필요합니다.`)
        environment.set(name, value)
      }
      variables.forEach((name, index) => environment.set(name, values[index]))
      for (const assignment of sorted)
        environment.set(
          assignment.name,
          evaluateExpression(assignment, environment),
        )
      const auxiliary: Record<string, number> = Object.create(null)
      for (const assignment of assignments)
        auxiliary[assignment.name] = environment.get(assignment.name)!
      return {
        residuals: roots.map((root) => evaluateExpression(root, environment)),
        auxiliary,
        evaluationNames: roots.length
          ? []
          : [
              ...assignments.map((assignment) => assignment.name),
              ...anonymousNames,
            ],
        evaluationValues: roots.length
          ? []
          : [
              ...assignments.map((assignment) => auxiliary[assignment.name]),
              ...anonymous.map((expression) =>
                evaluateExpression(expression, environment),
              ),
            ],
      }
    },
  }
  if (cache.size >= 16) cache.delete(cache.keys().next().value!)
  cache.set(key, compiled)
  return compiled
}
