import { readFile } from 'node:fs/promises'
import { SingularValueDecomposition } from 'ml-matrix'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createSolver } from '../src/engine'
import { classifyCondition, conditionNumber } from '../src/engine/conditioning'
import { computeSweeps } from '../src/engine/sweep'

function relative(actual: number, expected: number, tolerance = 1e-12) {
  expect(Math.abs(actual / expected - 1)).toBeLessThan(tolerance)
}
afterEach(() => vi.restoreAllMocks())

describe('condition numbers on the original coefficient matrix', () => {
  it('distinguishes the closed-form spectral and infinity norms of a non-symmetric matrix', () => {
    const matrix = [
      [1, 1],
      [0, 1],
    ]
    relative(conditionNumber(matrix, '2'), (3 + Math.sqrt(5)) / 2)
    expect(conditionNumber(matrix, 'infinity')).toBe(4)
    expect(conditionNumber(matrix)).toBe(4)
    expect(matrix).toEqual([
      [1, 1],
      [0, 1],
    ])
  })
  it('keeps the spectral condition at one for scaled orthogonal matrices', () => {
    relative(
      conditionNumber(
        [
          [3, 4],
          [-4, 3],
        ],
        '2',
      ),
      1,
    )
    relative(
      conditionNumber(
        [
          [1, 1],
          [1, -1],
        ],
        '2',
      ),
      1,
    )
    expect(
      conditionNumber(
        [
          [1, 1],
          [1, -1],
        ],
        'infinity',
      ),
    ).toBe(2)
  })
  it('uses singular-value ratios without squaring ill-conditioning', () => {
    relative(
      conditionNumber(
        [
          [1, 0],
          [0, 1e-100],
        ],
        '2',
      ),
      1e100,
    )
    relative(
      conditionNumber(
        [
          [1, 0],
          [0, 1e-300],
        ],
        '2',
      ),
      1e300,
    )
  })
  it('is invariant under extreme finite global scaling', () => {
    for (const scale of [1e-300, 1e300]) {
      relative(
        conditionNumber(
          [
            [scale, scale],
            [0, scale],
          ],
          '2',
        ),
        (3 + Math.sqrt(5)) / 2,
      )
      relative(
        conditionNumber(
          [
            [scale, scale],
            [0, scale],
          ],
          'infinity',
        ),
        4,
      )
    }
    expect(conditionNumber([[1e-320]], '2')).toBe(1)
    expect(conditionNumber([[-1e308]], '2')).toBe(1)
  })
  it('detects exact singular and zero matrices', () => {
    expect(
      conditionNumber(
        [
          [1, 1],
          [1, 1],
        ],
        '2',
      ),
    ).toBe(Infinity)
    expect(
      conditionNumber(
        [
          [1, 1],
          [1, 1],
        ],
        'infinity',
      ),
    ).toBe(Infinity)
    expect(
      conditionNumber(
        [
          [0, 0],
          [0, 0],
        ],
        '2',
      ),
    ).toBe(Infinity)
    expect(
      conditionNumber(
        [
          [1, 0],
          [0, 0],
        ],
        '2',
      ),
    ).toBe(Infinity)
  })
  it('preserves a small singular value for a nearly dependent system', () => {
    const d = 1e-9
    const matrix = [
      [1, 1],
      [1, 1 + d],
    ]
    const determinant = 1 + d - 1
    const frobeniusSquared = 3 + (1 + d) ** 2
    const sigmaMaxSquared =
      (frobeniusSquared +
        Math.sqrt(frobeniusSquared ** 2 - 4 * determinant ** 2)) /
      2
    relative(conditionNumber(matrix, '2'), sigmaMaxSquared / determinant, 1e-6)
  })
  it('handles the supported 64-variable size', () => {
    const matrix = Array.from({ length: 64 }, (_, i) =>
      Array.from({ length: 64 }, (_, j) => (i === j ? i + 1 : 0)),
    )
    relative(conditionNumber(matrix, '2'), 64)
  })
  it('rejects invalid matrix or norm inputs instead of inventing diagnostics', () => {
    expect(() => conditionNumber([], '2')).toThrow()
    expect(() => conditionNumber([[1, 2]], '2')).toThrow()
    expect(() => conditionNumber([[NaN]], '2')).toThrow()
    expect(() => conditionNumber([[Infinity]], 'infinity')).toThrow()
    expect(() => conditionNumber([[1]], 'bad' as '2')).toThrow()
  })
})

describe('interpretable sensitivity bands', () => {
  it.each([
    [1, 'stable', '안정'],
    [9999, 'stable', '안정'],
    [1e4, 'sensitive', '민감'],
    [1e8 - 1, 'sensitive', '민감'],
    [1e8, 'very-sensitive', '매우 민감'],
    [Infinity, 'very-sensitive', '매우 민감'],
    [NaN, 'unavailable', '판정 불가'],
    [0, 'unavailable', '판정 불가'],
    [-Infinity, 'unavailable', '판정 불가'],
  ])('classifies %s with an explicit text label', (value, level, label) => {
    expect(classifyCondition(value)).toMatchObject({ level, label })
    expect(classifyCondition(value).description.length).toBeGreaterThan(10)
  })
})

describe('selected diagnostics and lightweight sweeps', () => {
  let solve: Awaited<ReturnType<typeof createSolver>>
  beforeAll(async () => {
    solve = await createSolver(
      await readFile(new URL('../public/solver.wasm', import.meta.url)),
    )
  })
  it('selects a norm without altering the solution or residuals', () => {
    const source = 'x + y = 3\ny = 1'
    const original = solve(source, {})
    const spectral = solve(source, {}, { conditionNorm: '2' })
    expect(original.conditionNorm).toBe('infinity')
    expect(original.condition).toBe(4)
    expect(spectral.conditionNorm).toBe('2')
    relative(spectral.condition, (3 + Math.sqrt(5)) / 2)
    expect(spectral.values).toEqual(original.values)
    expect(spectral.residuals).toEqual(original.residuals)
    expect(spectral.engine).toBe('wasm')
  })
  it('does not confuse row equilibration with the original-matrix diagnostic', () => {
    const result = solve('1e-15*x = 1e-15\ny = 2', {}, { conditionNorm: '2' })
    expect(result.values).toEqual([1, 2])
    relative(result.condition, 1e15)
    expect(classifyCondition(result.condition).level).toBe('very-sensitive')
  })
  it('skips SVD on graph and table points while retaining current-result diagnostics', () => {
    const getter = vi.spyOn(
      SingularValueDecomposition.prototype,
      'diagonal',
      'get',
    )
    const result = solve('x = k', { k: 1 }, { conditionNorm: '2' })
    expect(result.condition).toBe(1)
    expect(getter).toHaveBeenCalledTimes(1)
    const sweeps = computeSweeps(
      solve,
      'x = k',
      { k: 1 },
      { name: 'k', min: 0, max: 1, steps: 81, step: 0.01 },
    )
    expect(sweeps.sweep).toHaveLength(81)
    expect(sweeps.dataset).toHaveLength(101)
    expect(getter).toHaveBeenCalledTimes(1)
    const unchecked = solve(
      'x = k',
      { k: 1 },
      { conditionNorm: '2', computeCondition: false },
    )
    expect(unchecked.condition).toBeNaN()
    expect(unchecked.values).toEqual([1])
    expect(unchecked.warnings).toEqual([])
  })
  it('retains a valid solve if SVD diagnostics fail', () => {
    vi.spyOn(
      SingularValueDecomposition.prototype,
      'diagonal',
      'get',
    ).mockImplementation(() => {
      throw new Error('simulated SVD failure')
    })
    const result = solve('x = 2', {}, { conditionNorm: '2' })
    expect(result.values).toEqual([2])
    expect(result.condition).toBeNaN()
    expect(result.conditionError).toContain('조건수')
    expect(classifyCondition(result.condition).level).toBe('unavailable')
    expect(result.warnings.join()).toContain('계산하지 못했습니다')
  })
})
