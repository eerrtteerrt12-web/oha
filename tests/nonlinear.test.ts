import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import { ModelError } from '../src/engine'
import { createNonlinearSolver } from '../src/engine/nonlinear'

let solve: Awaited<ReturnType<typeof createNonlinearSolver>>
beforeAll(async () => {
  solve = await createNonlinearSolver(
    await readFile(new URL('../public/solver.wasm', import.meta.url)),
  )
})
const scalar = (expression: string, min = 0, max = 3) =>
  `f(x) = ${expression}\nx(min) = ${min}\nx(max) = ${max}`
const system = (first: string, second: string, x = 3, y = 2) =>
  `f(x) = ${first}\nf(y) = ${second}\nx(0) = ${x}\ny(0) = ${y}`
const near = (values: number[], expected: number[]) => {
  expect(values).toHaveLength(expected.length)
  values.forEach((value, index) =>
    expect(value).toBeCloseTo(expected[index], 8),
  )
}

describe('nonlinear single-root intervals', () => {
  it('selects the positive or negative branch by numeric bounds', () => {
    const positive = solve(scalar('x^2 - 4'), {})
    const negative = solve(scalar('x^2 - 4', -3, 0), {})
    near(positive.values, [2])
    near(negative.values, [-2])
    expect(positive.kind).toBe('nonlinear')
    expect(positive.method).toContain('이분법')
    expect(positive.engine).toBe('javascript')
    expect(positive.maxResidual).toBeLessThan(1e-10)
    expect(positive.iterations).toBeGreaterThan(0)
    expect(positive.warnings.join()).toContain('다른 근')
  })
  it('solves the provided logarithmic helper example with log base ten', () => {
    const result = solve(
      'f(x) = t + 4*x^2 - 1620\nt = x*log(x/2)\nx(min) = .1\nx(max) = 100',
      {},
    )
    near(result.values, [20])
    expect(result.auxiliary!.t).toBeCloseTo(20, 8)
    expect(result.matrix[0][0]).toBeCloseTo(160 + 1 + 1 / Math.LN10, 6)
    expect(result.rhs[0]).toBe(-result.residuals[0])
  })
  it('evaluates helper dependencies in DAG order, independent of source order', () => {
    const result = solve(
      'f(x) = final - 1\nfinal = ln(intermediate)\nintermediate = x\nx(min) = .1\nx(max) = 10',
      {},
    )
    near(result.values, [Math.E])
    expect(result.auxiliary!.final).toBeCloseTo(1, 9)
    expect(result.auxiliary!.intermediate).toBeCloseTo(Math.E, 9)
  })
  it('supports repeated external-parameter solves without caching old values', () => {
    const source = scalar('x^2 - target', 0, 10)
    near(solve(source, { target: 4 }).values, [2])
    near(solve(source, { target: 9 }).values, [3])
    near(solve(source, { target: 16 }).values, [4])
  })
  it('finds an endpoint root and a selected negative cubic root', () => {
    expect(solve(scalar('x - 2', 2, 4), {}).values).toEqual([2])
    expect(solve(scalar('x - 2', 0, 2), {}).values).toEqual([2])
    near(solve(scalar('x^3 - x', -2, -0.2), {}).values, [-1])
  })
  it('is invariant to small or large residual scaling', () => {
    near(solve(scalar('1e-20*(x^2 - 4)'), {}).values, [2])
    near(solve(scalar('1e20*(x^2 - 4)'), {}).values, [2])
  })
  it('requires a sign-changing bracket when neither endpoint is a root', () => {
    expect(() => solve(scalar('x^2 + 1'), {})).toThrow('부호')
    expect(() => solve(scalar('(x-1)^2'), {})).toThrow('부호')
  })
  it.each(['1/(x-.1)', 'tan(x)'])(
    'does not accept a sign jump or pole as a root: %s',
    (expression) => {
      const source =
        expression === 'tan(x)'
          ? scalar(expression, 1, 2)
          : scalar(expression, 0, 1)
      expect(() => solve(source, {})).toThrow(ModelError)
    },
  )
  it('rejects undefined interior points and reports the actual helper line', () => {
    try {
      solve('f(x) = helper\nhelper = 1/x\nx(min) = -1\nx(max) = 1', {})
      throw new Error('Expected domain error')
    } catch (error) {
      expect(error).toBeInstanceOf(ModelError)
      expect((error as ModelError).line).toBe(2)
    }
  })
  it('does not let a large endpoint residual conceal another discontinuity', () => {
    expect(() => solve(scalar('1/(x*(x-.9))', 1e-300, 1), {})).toThrow(
      ModelError,
    )
  })
  it('gives root-line context for a numerical interval failure', () => {
    try {
      solve('# note\nf(x)=x^2+1\nx(min)=0\nx(max)=3', {})
      throw new Error('Expected bracket error')
    } catch (error) {
      expect(error).toBeInstanceOf(ModelError)
      expect((error as ModelError).line).toBe(2)
    }
  })
})

describe('nonlinear simultaneous Newton solver', () => {
  it('uses the actual WASM Gaussian kernel and returns the local Jacobian', () => {
    const result = solve(system('x^2+y^2-25', 'x-y-1', 4, 3), {})
    near(result.values, [4, 3])
    expect(result.engine).toBe('wasm')
    expect(result.matrix[0][0]).toBeCloseTo(8, 7)
    expect(result.matrix[0][1]).toBeCloseTo(6, 7)
    expect(result.matrix[1][0]).toBeCloseTo(1, 7)
    expect(result.matrix[1][1]).toBeCloseTo(-1, 7)
    expect(result.rhs.every((value) => value === 0)).toBe(true)
    expect(result.iterations).toBe(0)
    expect(result.method).toContain('Newton')
  })
  it('solves the provided NLES log example with explicit helper output', () => {
    const result = solve(
      'f(c)=3.8907-ln(6*c)-a\nf(a)=a+b-c\nb=5*a-3\nc(0)=2\na(0)=2',
      {},
    )
    expect(result.variables).toEqual(['c', 'a'])
    expect(result.maxResidual).toBeLessThan(1e-9)
    expect(result.values[0]).toBeCloseTo(6 * result.values[1] - 3, 9)
    expect(result.auxiliary!.b).toBeCloseTo(5 * result.values[1] - 3, 10)
    expect(result.iterations).toBeGreaterThan(0)
  })
  it('selects system branches by initial guesses', () => {
    near(solve(system('x^2-4', 'y-x', 3, 2), {}).values, [2, 2])
    near(solve(system('x^2-4', 'y-x', -3, -2), {}).values, [-2, -2])
  })
  it('uses line search to remain inside logarithm domain', () => {
    const result = solve(system('ln(x)', 'y-x', 10, 10), {})
    near(result.values, [1, 1])
    expect(result.maxResidual).toBeLessThan(1e-10)
  })
  it('equilibrates equations using very different units', () => {
    const result = solve(system('1e-20*(x^2-4)', '1e20*(y-x)', 3, 1), {})
    near(result.values, [2, 2])
  })
  it('supports local derivatives near domain boundaries', () => {
    const result = solve(system('ln(x)+20', 'y-x', 1e-9, 1e-9), {})
    expect(result.values[0] / Math.exp(-20)).toBeCloseTo(1, 8)
    expect(result.values[1] / Math.exp(-20)).toBeCloseTo(1, 8)
  })
  it('does not accept an asymptotic residual decrease as a finite root', () => {
    expect(() => solve(system('1/(x-.1)', 'y', 0, 1), {})).toThrow(ModelError)
  })
  it('rejects an undefined starting point', () => {
    expect(() => solve(system('ln(x)', 'y-x', -1, 1), {})).toThrow('정의역')
  })
  it('rejects rank-deficient Jacobians rather than fabricating unique roots', () => {
    expect(() => solve(system('x+y-2', '2*x+2*y-4', 0, 0), {})).toThrow(
      'Jacobian',
    )
    expect(() => solve(system('x+y-2', '2*x+2*y-4', 1, 1), {})).toThrow(
      'Jacobian',
    )
  })
  it('reports nonconvergence for a system with no real solution', () => {
    expect(() => solve(system('x^2+1', 'y-x', 1, 0), {})).toThrow(ModelError)
  })
  it('calculates the selected norm of the final Jacobian', () => {
    const source = system('3*x^2-12', '2*y-4', 3, 3)
    const inf = solve(source, {}, { conditionNorm: 'infinity' })
    const two = solve(source, {}, { conditionNorm: '2' })
    near(two.values, [2, 2])
    expect(inf.condition).toBeCloseTo(6, 6)
    expect(two.condition).toBeCloseTo(6, 6)
    expect(two.conditionNorm).toBe('2')
  })
  it('skips diagnostics for sweeps and rejects unknown condition norms', () => {
    expect(
      Number.isNaN(
        solve(system('x^2-4', 'y-x'), {}, { computeCondition: false })
          .condition,
      ),
    ).toBe(true)
    expect(() =>
      solve(scalar('x^2-4'), {}, { conditionNorm: 'invalid' as '2' }),
    ).toThrow('조건수')
  })
})

describe('expression-only mode and honest fallback', () => {
  it('evaluates NLE0 helpers and anonymous results without root claims', () => {
    const result = solve('a=1\nb=4\nx=a+b^2\nx+2', {})
    expect(result.kind).toBe('evaluation')
    expect(result.variables).toEqual(['a', 'b', 'x', 'result_1'])
    expect(result.values).toEqual([1, 4, 17, 19])
    expect(result.matrix).toEqual([])
    expect(result.residuals).toEqual([])
    expect(Number.isNaN(result.condition)).toBe(true)
    expect(result.conditionError).toContain('적용되지')
    expect(result.iterations).toBe(0)
    expect(result.engine).toBe('javascript')
  })
  it('keeps results and explicitly labels unavailable WASM for NLES', async () => {
    const fallback = await createNonlinearSolver(new Uint8Array([0]))
    const source = system('x^2-4', 'y-x')
    const result = fallback(source, {})
    near(result.values, solve(source, {}).values)
    expect(result.engine).toBe('javascript')
    expect(result.warnings.join()).toContain('WebAssembly')
    expect(result.warnings.join()).toContain('JavaScript')
  })
  it('does not silently enable unsupported constrained methods', () => {
    expect(() =>
      solve('#@ NLE_SOLUTION_METHOD_INDEX = 3\n' + system('x+y-1', 'x-y'), {}),
    ).toThrow('지원하지')
  })
})
