import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import { createSolver, ModelError, compileModel } from '../src/engine'
let solve: Awaited<ReturnType<typeof createSolver>>
beforeAll(async () => {
  solve = await createSolver(
    await readFile(new URL('../public/solver.wasm', import.meta.url)),
  )
})
const near = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 9))
}
describe('WebAssembly LEQ solver', () => {
  it('uses the real wasm kernel with coefficient shorthand', () => {
    const result = solve('2x + 3y = 12\n4x = 5 + y', {})
    expect(result.engine).toBe('wasm')
    near(result.values, [27 / 14, 19 / 7])
    expect(result.maxResidual).toBeLessThan(1e-12)
  })
  it('solves the approved five-variable example in encounter order', () => {
    const result = solve(
      'c + e = 1\n3*b - 2*c - 2*d = -2\n2*a - 0.27*c - d - 2*e = -1\nb = 0.25*c\n1.5*a = e',
      {},
    )
    expect(result.variables).toEqual(['c', 'e', 'b', 'd', 'a'])
    expect(result.maxResidual).toBeLessThan(1e-12)
    const byName = Object.fromEntries(
      result.variables.map((name, i) => [name, result.values[i]]),
    )
    expect(byName.c + byName.e).toBeCloseTo(1, 12)
    expect(byName.b).toBeCloseTo(0.25 * byName.c, 12)
  })
  it('solves parameterized mixing and reuses compiled expressions', () => {
    const source = '# flow balance\nx + y = F\nc_A*x + c_B*y = c_T*F'
    const parameters = { F: 100, c_A: 0.2, c_B: 0.8, c_T: 0.5 }
    near(solve(source, parameters).values, [50, 50])
    near(solve(source, { ...parameters, c_T: 0.65 }).values, [25, 75])
    expect(compileModel(source)).toBe(compileModel(source))
  })
  it('pivots when the first diagonal entry is zero', () => {
    near(solve('0*x + y = 3\nx + y = 5', {}).values, [2, 3])
  })
  it('equilibrates equations with very different scales', () => {
    near(
      solve('1e-15*x + 1e-15*y = 3e-15\n1e15*x - 1e15*y = -1e15', {}).values,
      [1, 2],
    )
  })
  it('supports parentheses and division only when linear', () => {
    near(solve('(x + y)/2 = 3\nx - y = 2', {}).values, [4, 2])
  })
  it('supports whitespace shorthand and scientific notation', () => {
    near(solve('.5 x + 1e-1 y = 1.2\nx - y = 0', {}).values, [2, 2])
  })
  it('solves one-variable systems', () => {
    near(solve('3x = 12', {}).values, [4])
  })
  it('reports an infinity-norm condition number', () => {
    expect(solve('x = 2\ny = 3', {}).condition).toBeCloseTo(1, 12)
  })
  it('keeps condition diagnostics invariant to extreme global coefficient scales', () => {
    expect(solve('1e-320*x = 1e-320', {}).condition).toBeCloseTo(1, 12)
    expect(
      solve('1e308*x + 1e308*y = 1e308\n1e308*x - 1e308*y = 1e308', {})
        .condition,
    ).toBeCloseTo(2, 12)
  })
  it('does not overflow residual products when a finite solution cancels large terms', () => {
    const result = solve('1e308*x + 1e308*y = 1e308\nx - y = 3', {})
    near(result.values, [2, -1])
    expect(result.maxResidual).toBe(0)
    expect(result.residuals.every(Number.isFinite)).toBe(true)
  })
  it('reports inconsistent equations distinctly', () => {
    expect(() => solve('x + y = 2\n2x + 2y = 5', {})).toThrow('해가 없습니다')
  })
  it('rejects a rank-deficient system without inventing a solution', () => {
    expect(() => solve('x + y = 2\n2x + 2y = 4', {})).toThrow('독립적인 수식')
  })
  it('warns when a solution is sensitive to perturbations', () => {
    const result = solve('x + y = 2\nx + 1.000000001*y = 2.000000001', {})
    expect(result.condition).toBeGreaterThan(1e8)
    expect(result.warnings.join()).toContain('조건수')
  })
  it('does not classify literal parameter assignments as parameters automatically', () => {
    expect(() => solve('x + y = F', {})).toThrow('수식 1개와 미지수 3개')
  })
})
describe('safe expression validation', () => {
  it.each(['x*y = 2\nx+y = 3', 'x^2 + y = 2\nx+y = 3', 'x/y = 2\nx+y = 3'])(
    'rejects nonlinear expressions: %s',
    (source) => {
      expect(() => solve(source, {})).toThrow(ModelError)
    },
  )
  it.each([
    'x =',
    'x = y = 3',
    'x + y',
    'x + *y = 2',
    'x y = 2',
    'x 2 = 3',
    'sin(x) = 2',
    'x = 1e999',
    'x = alert(1)',
    'x = globalThis.process',
    'x = (2 + 3',
  ])('rejects invalid syntax: %s', (source) => {
    expect(() => solve(source, {})).toThrow(ModelError)
  })
  it('returns the source line number for actionable errors', () => {
    try {
      solve('# comment\nx + y = 3\nx*y = 2', {})
      throw new Error('expected parser failure')
    } catch (error) {
      expect(error).toBeInstanceOf(ModelError)
      expect((error as ModelError).line).toBe(3)
    }
  })
  it('rejects zero denominators and nonfinite parameter values', () => {
    expect(() => solve('x / k = 2', { k: 0 })).toThrow('0으로 나눌')
    expect(() => solve('x = k', { k: Infinity })).toThrow('유한한 숫자')
  })
  it('limits input size and nesting', () => {
    expect(() => solve('x'.repeat(30001), {})).toThrow('30,000자')
    expect(() =>
      solve('x = ' + '('.repeat(90) + '1' + ')'.repeat(90), {}),
    ).toThrow('중첩')
  })
  it('limits the number of equations', () => {
    expect(() =>
      solve(
        Array.from({ length: 65 }, (_, i) => `x${i} = ${i}`).join('\n'),
        {},
      ),
    ).toThrow('최대 64')
  })
})
describe('honest JavaScript fallback', () => {
  it('preserves results and reports unavailable wasm', async () => {
    const fallback = await createSolver(new Uint8Array([0]))
    const source = '2x + 3y = 12\n4x = 5 + y'
    const result = fallback(source, {})
    expect(result.engine).toBe('javascript')
    expect(result.warnings.join()).toContain('JavaScript')
    near(result.values, solve(source, {}).values)
  })
})
