import {
  evaluateNonlinearExpression,
  type NonlinearNode,
} from './nonlinear-parser'

const MAX_DEGREE = 12

/** Return ascending coefficients only for algebraic operations that preserve a
 * polynomial's domain. No source code is executed during classification. */
export function polynomialCoefficients(
  node: NonlinearNode,
  variable: string,
  constants: Record<string, number>,
  helpers: Map<string, NonlinearNode>,
): number[] | null {
  const active = new Set<string>()
  const memo = new Map<string, number[] | null>()
  const finite = (coefficients: number[]) =>
    coefficients.every(Number.isFinite) ? trim(coefficients) : null
  const add = (a: number[], b: number[], sign = 1) => {
    const result = Array<number>(Math.max(a.length, b.length)).fill(0)
    for (let i = 0; i < result.length; i += 1)
      result[i] = (a[i] ?? 0) + sign * (b[i] ?? 0)
    return finite(result)
  }
  const multiply = (a: number[], b: number[]) => {
    if (a.length + b.length - 2 > MAX_DEGREE) return null
    const result = Array<number>(a.length + b.length - 1).fill(0)
    for (let i = 0; i < a.length; i += 1)
      for (let j = 0; j < b.length; j += 1) result[i + j] += a[i] * b[j]
    return finite(result)
  }
  const power = (base: number[], exponent: number): number[] | null => {
    if (!Number.isInteger(exponent) || exponent < 0 || exponent > MAX_DEGREE)
      return null
    let result = [1]
    for (let i = 0; i < exponent; i += 1) {
      const next = multiply(result, base)
      if (!next) return null
      result = next
    }
    return result
  }
  const visit = (current: NonlinearNode, depth = 0): number[] | null => {
    if (depth > 256) return null
    if (current.kind === 'number') return [current.value]
    if (current.kind === 'name') {
      if (current.name === variable) return [0, 1]
      if (Object.hasOwn(constants, current.name)) {
        const value = constants[current.name]
        return Number.isFinite(value) ? [value] : null
      }
      if (current.name === 'pi') return [Math.PI]
      if (current.name === 'e') return [Math.E]
      if (memo.has(current.name)) return memo.get(current.name)!
      const helper = helpers.get(current.name)
      if (!helper || active.has(current.name)) return null
      active.add(current.name)
      const result = visit(helper, depth + 1)
      active.delete(current.name)
      memo.set(current.name, result)
      return result
    }
    if (current.kind === 'unary') {
      const child = visit(current.child, depth + 1)
      return (
        child?.map((value) => (current.sign === '-' ? -value : value)) ?? null
      )
    }
    if (current.kind === 'binary') {
      const left = visit(current.left, depth + 1)
      const right = visit(current.right, depth + 1)
      if (!left || !right) return null
      if (current.operator === '+') return add(left, right)
      if (current.operator === '-') return add(left, right, -1)
      if (current.operator === '*') return multiply(left, right)
      if (current.operator === '/')
        return right.length === 1 && right[0] !== 0
          ? finite(left.map((value) => value / right[0]))
          : null
      if (current.operator === '^')
        return right.length === 1 ? power(left, right[0]) : null
      return null
    }
    const args = current.args.map((argument) => visit(argument, depth + 1))
    if (args.some((argument) => argument === null)) return null
    if (current.name === 'pow' && args[1]!.length === 1)
      return power(args[0]!, args[1]![0])
    if (args.some((argument) => argument!.length !== 1)) return null
    try {
      const value = evaluateNonlinearExpression(
        {
          node: {
            kind: 'call',
            name: current.name,
            args: args.map((argument) => ({
              kind: 'number',
              value: argument![0],
            })),
          },
          line: 1,
          references: new Set(),
        },
        new Map(),
      )
      return Number.isFinite(value) ? [value] : null
    } catch {
      return null
    }
  }
  return visit(node)
}

function trim(coefficients: number[]) {
  const result = [...coefficients]
  while (result.length > 1 && result[result.length - 1] === 0) result.pop()
  return result
}

/** Numerically isolate real polynomial roots using derivative critical points.
 * Coefficient arithmetic and root isolation use floating point, so this is not
 * a symbolic certificate of completeness or of exact multiplicity. */
export function findPolynomialRealRoots(
  coefficients: number[],
  bounds?: { min: number; max: number },
): { roots: number[]; min: number; max: number; identicallyZero?: boolean } {
  const original = trim(coefficients)
  const scale = Math.max(...original.map(Math.abs))
  // Retain very small coefficients if global normalization would erase them.
  const normalized =
    scale > 0
      ? original.some((value) => value !== 0 && value / scale === 0)
        ? original
        : original.map((value) => value / scale)
      : [0]
  const degree = normalized.length - 1
  let extent = 1
  if (degree > 0) {
    const leading = Math.abs(normalized[degree])
    const ratio = Math.max(
      ...normalized.slice(0, -1).map((value) => Math.abs(value) / leading),
    )
    extent = 1 + ratio
    // Fujiwara is often much tighter for tiny roots and remains finite when
    // the Cauchy ratio overflows. Neither bound assumes the root scale is 1.
    const fujiwara =
      2 *
      Math.max(
        0,
        ...original
          .slice(0, -1)
          .map((value, index) =>
            value === 0
              ? 0
              : Math.exp(
                  (Math.log(Math.abs(value)) -
                    Math.log(Math.abs(original[degree]))) /
                    (degree - index),
                ),
          ),
      )
    if (fujiwara > 0) extent = Math.min(extent, fujiwara)
    if (!Number.isFinite(extent)) extent = Number.MAX_VALUE / 4
  }
  const min = bounds?.min ?? -extent
  const max = bounds?.max ?? extent
  if (scale === 0) return { roots: [], min, max, identicallyZero: true }
  if (
    degree === 0 ||
    degree > MAX_DEGREE ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min > max
  )
    return { roots: [], min, max }

  const isolate = (polynomial: number[]): number[] => {
    const count = polynomial.length - 1
    if (count === 0) return []
    // Preserve an exact zero root instead of bisecting toward subnormal
    // underflow in x*Q(x), which can produce an artificial nonzero candidate.
    if (polynomial[0] === 0)
      return unique([
        ...(min <= 0 && max >= 0 ? [0] : []),
        ...isolate(polynomial.slice(1)),
      ])
    if (count === 1) {
      const root = -polynomial[0] / polynomial[1]
      return Number.isFinite(root) && root >= min && root <= max ? [root] : []
    }
    const derivative = polynomial
      .slice(1)
      .map((value, index) => value * (index + 1))
    const critical = isolate(derivative)
    const knots = unique([min, ...critical, max])
    const roots: number[] = []
    for (const point of knots) {
      const sample = evaluate(polynomial, point)
      // Expanded coefficients can lose a few ulps at a repeated root; the
      // original model still verifies every returned candidate in the caller.
      if (Math.abs(sample.value) <= sample.roundoff) roots.push(point)
    }
    for (let i = 1; i < knots.length; i += 1) {
      let left = knots[i - 1],
        right = knots[i]
      let leftValue = evaluate(polynomial, left).value
      const rightValue = evaluate(polynomial, right).value
      if (
        leftValue === 0 ||
        rightValue === 0 ||
        Math.sign(leftValue) === Math.sign(rightValue)
      )
        continue
      for (let iteration = 0; iteration < 1200; iteration += 1) {
        const middle = left / 2 + right / 2
        if (middle === left || middle === right) break
        const middleValue = evaluate(polynomial, middle).value
        if (middleValue === 0) {
          left = middle
          right = middle
          break
        }
        if (Math.sign(middleValue) === Math.sign(leftValue)) {
          left = middle
          leftValue = middleValue
        } else right = middle
      }
      const middle = left / 2 + right / 2
      const candidates = [left, middle, right]
      candidates.sort(
        (a, b) =>
          Math.abs(evaluate(polynomial, a).value) -
          Math.abs(evaluate(polynomial, b).value),
      )
      roots.push(candidates[0])
    }
    return unique(roots)
  }
  return { roots: isolate(normalized), min, max }
}

function unique(values: number[]) {
  return values
    .sort((a, b) => a - b)
    .filter(
      (value, index, sorted) =>
        index === 0 ||
        Math.abs(value - sorted[index - 1]) >
          64 *
            Number.EPSILON *
            Math.max(
              Number.MIN_VALUE,
              Math.abs(value),
              Math.abs(sorted[index - 1]),
            ),
    )
}

// Compensated Horner evaluation keeps signs trustworthy near cancellation.
// For large x evaluate P(x)/x^degree, avoiding overflow without moving its roots.
function evaluate(coefficients: number[], x: number) {
  const reverse = Math.abs(x) > 1
  const factor = reverse ? 1 / x : x
  const sequence = reverse ? coefficients : [...coefficients].reverse()
  let value = sequence[0],
    correction = 0,
    magnitude = Math.abs(sequence[0])
  for (let i = 1; i < sequence.length; i += 1) {
    const product = value * factor
    const productError = twoProductError(value, factor, product)
    const sum = product + sequence[i]
    const z = sum - product
    const sumError = product - (sum - z) + (sequence[i] - z)
    correction = correction * factor + (productError + sumError)
    value = sum
    magnitude = magnitude * Math.abs(factor) + Math.abs(sequence[i])
  }
  const sign = reverse && x < 0 && (coefficients.length - 1) % 2 ? -1 : 1
  return {
    value: (value + correction) * sign,
    roundoff: 2 * Number.EPSILON * coefficients.length * magnitude,
  }
}

function twoProductError(a: number, b: number, product: number) {
  const splitter = 134_217_729
  const aSplit = splitter * a,
    bSplit = splitter * b
  if (!Number.isFinite(aSplit) || !Number.isFinite(bSplit)) return 0
  const aHigh = aSplit - (aSplit - a),
    bHigh = bSplit - (bSplit - b)
  const aLow = a - aHigh,
    bLow = b - bHigh
  return aHigh * bHigh - product + aHigh * bLow + aLow * bHigh + aLow * bLow
}
