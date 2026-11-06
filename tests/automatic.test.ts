import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import { ModelError } from '../src/engine'
import {
  createAutomaticSolver,
  normalizeAutomaticModel,
} from '../src/engine/automatic'

let search: Awaited<ReturnType<typeof createAutomaticSolver>>
beforeAll(async () => {
  search = await createAutomaticSolver(
    await readFile(new URL('../public/solver.wasm', import.meta.url)),
  )
})

const expectRoots = (
  source: string,
  expected: number[],
  parameters: Record<string, number> = {},
) => {
  const result = search(source, parameters)
  expect(result.solutions).toHaveLength(expected.length)
  result.solutions.forEach((solution, index) => {
    const root = solution.values[0]
    if (expected[index] === 0) expect(root).toBe(0)
    else expect(root / expected[index]).toBeCloseTo(1, 9)
    expect(solution.maxResidual).toBeLessThan(1e-8)
  })
  return result
}

describe('automatic real polynomial roots without conditions', () => {
  it.each([
    ['x^2 = 4', [2, -2]],
    ['x^4 - 5*x^2 + 4 = 0', [1, -1, 2, -2]],
    ['x^3 - x = 0', [0, 1, -1]],
    ['(x-1)^2 = 0', [1]],
    ['(x^2-2)^2 = 0', [Math.SQRT2, -Math.SQRT2]],
    ['x^2 = 0', [0]],
    ['x^2 + 1 = 0', []],
    ['x = 1000000', [1000000]],
  ] as const)('solves %s', (source, roots) => {
    const result = expectRoots(source, [...roots])
    expect(result.search.method).toContain('다항식')
    expect(result.search.note).toContain('보장하지 않습니다')
  })

  it('keeps distinct tiny roots rather than merging on an absolute tolerance', () => {
    expectRoots('x*(x-1e-15) = 0', [0, 1e-15])
    expectRoots('(x-1e-9)*(x-2e-9) = 0', [1e-9, 2e-9])
    expectRoots('x^2 = 1e-100', [1e-50, -1e-50])
  })

  it('validates extrema against the original expression instead of reporting a small positive minimum', () => {
    expectRoots('(x-1)^2 + 1e-16 = 0', [])
    expectRoots('x^2 + 1e-100 = 0', [])
  })

  it('honors optional search bounds and recomputes external parameters', () => {
    expectRoots('x^2 = target', [2, -2], { target: 4 })
    expectRoots('x^2 = target', [3, -3], { target: 9 })
    const result = search(
      'x^2=4',
      {},
      { searchBounds: { min: 0, max: 10 }, conditionNorm: '2' },
    )
    expect(result.solutions).toHaveLength(1)
    expect(result.solutions[0].values).toEqual([2])
    expect(result.solutions[0].conditionNorm).toBe('2')
    expect(result.search).toMatchObject({ min: 0, max: 10 })
  })

  it('retains explicit f/helper syntax while making its conditions optional', () => {
    const result = expectRoots(
      'f(x) = helper - target\nhelper = x^2',
      [2, -2],
      { target: 4 },
    )
    expect(
      result.solutions.map((solution) => solution.auxiliary!.helper),
    ).toEqual([4, 4])
    expectRoots('f(x)=x^2-4\nx(min)=0\nx(max)=3', [2, -2])
  })

  it('reports an identity as an underdetermined equation', () => {
    expect(() => search('x-x=0', {})).toThrow('독립적인 방정식')
  })
})

describe('bounded general real equation search', () => {
  it('finds all sine roots in a supplied finite interval and describes the numerical limitation', () => {
    const result = search(
      'sin(x)=0',
      {},
      { searchBounds: { min: -10, max: 10 } },
    )
    expect(result.solutions).toHaveLength(7)
    const expected = [0, 1, -1, 2, -2, 3, -3].map((value) => value * Math.PI)
    result.solutions.forEach((solution, index) =>
      expect(solution.values[0]).toBeCloseTo(expected[index], 9),
    )
    expect(result.search.note).toContain('누락될 수 있습니다')
    expect(result.search).toMatchObject({ min: -10, max: 10 })
  })

  it('labels a capped default sine search as truncated', () => {
    const result = search('sin(x)=0', {})
    expect(result.solutions).toHaveLength(32)
    expect(result.search).toMatchObject({
      min: -100,
      max: 100,
      truncated: true,
    })
    const expected = [0]
    for (let index = 1; expected.length < 32; index++) {
      expected.push(index * Math.PI)
      if (expected.length < 32) expected.push(-index * Math.PI)
    }
    result.solutions.forEach((solution, index) =>
      expect(solution.values[0]).toBeCloseTo(expected[index], 8),
    )
    expect(result.search.note).toContain('원점에 가까운 순서')
  })

  it('retains nearby periodic roots even with asymmetric bounds and more than 32 discoveries', () => {
    const result = search(
      'sin(x)*cos(x)=0',
      {},
      { searchBounds: { min: -180, max: 30 } },
    )
    expect(result.solutions).toHaveLength(32)
    expect(result.solutions[0].values).toEqual([0])
    for (const [index, solution] of result.solutions.entries()) {
      const multiple =
        index === 0 ? 0 : Math.ceil(index / 2) * (index % 2 ? 1 : -1)
      expect(solution.values[0]).toBeCloseTo((multiple * Math.PI) / 2, 8)
    }
    expect(result.search.truncated).toBe(true)
  })

  it.each(['1/(x-.1)=0', 'exp(-100*x)=0'])(
    'does not turn a pole or underflow tail into roots: %s',
    (source) => {
      expect(search(source, {}).solutions).toEqual([])
    },
  )

  it('finds a domain endpoint real root', () => {
    expectRoots('sqrt(x)=0', [0])
  })

  it('discovers a logarithmic root close to a domain boundary', () => {
    expectRoots('ln(x)+20=0', [Math.exp(-20)])
  })

  it('continues a selected scalar branch without requiring a new search', () => {
    const initial = search('x^2=target', { target: 4 }).solutions[0]
    const continued = search.solveNear('x^2=target', { target: 9 }, initial, {
      computeCondition: false,
    })
    expect(continued.values[0]).toBeCloseTo(3, 10)
    expect(Number.isNaN(continued.condition)).toBe(true)
    expect(
      search.solveNear('x^2=target', { target: 0 }, initial).values,
    ).toEqual([0])
    expect(() =>
      search.solveNear('x^2=target', { target: -1 }, initial),
    ).toThrow(ModelError)
  })
})

describe('automatic simultaneous equations', () => {
  it('discovers both circle intersections and uses the WASM Newton kernel', () => {
    const source = 'x^2+y^2=25\nx-y=1'
    const result = search(source, {})
    expect(result.solutions).toHaveLength(2)
    result.solutions.forEach((solution, index) => {
      const expected = index === 0 ? [4, 3] : [-3, -4]
      solution.values.forEach((value, i) =>
        expect(value).toBeCloseTo(expected[i], 8),
      )
      expect(solution.engine).toBe('wasm')
      expect(solution.maxResidual).toBeLessThan(1e-8)
    })
    const continued = search.solveNear(source, {}, result.solutions[0].values)
    expect(continued.values[0]).toBeCloseTo(4, 10)
  })

  it('terminates even when custom bounds contain only adjacent floating point values', () => {
    const result = search(
      'x=1\ny=1',
      {},
      { searchBounds: { min: 1, max: 1 + Number.EPSILON } },
    )
    expect(result.solutions).toHaveLength(1)
    expect(result.search.attempts).toBeLessThanOrEqual(4)
  })
})

describe('automatic model validation', () => {
  it('infers ordinary equation unknowns separately from parameters', () => {
    expect(normalizeAutomaticModel('x+y=target\nx-y=1', ['target'])).toEqual({
      source: 'f(x) = (x+y)-(target)\nf(y) = (x-y)-(1)',
      variables: ['x', 'y'],
    })
  })

  it.each([
    'x^2=4=5',
    'x+y=2',
    'x=globalThis.alert(1)',
    'x=constructor(1)',
    'x=2; process.exit()',
    'f(x)=missing+x',
    'f(x)=helper\nhelper=helper+x',
  ])('rejects unsafe or incomplete input: %s', (source) => {
    expect(() => search(source, {})).toThrow(ModelError)
  })

  it('validates bounds, parameters and continuation seeds', () => {
    expect(() =>
      search('x=1', {}, { searchBounds: { min: 1, max: 1 } }),
    ).toThrow(ModelError)
    expect(() => search('x=a', { a: Infinity })).toThrow(ModelError)
    expect(() => search.solveNear('x=1', {}, [1, 2])).toThrow(ModelError)
  })
})
