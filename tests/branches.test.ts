import { readFile } from 'node:fs/promises'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createAutomaticSolver } from '../src/engine/automatic'
import {
  computeBranchSweeps,
  continueRoot,
  type NearSolver,
} from '../src/engine/branches'
import type { SolveResult } from '../src/engine'

function root(value: number): SolveResult {
  return {
    kind: 'nonlinear',
    variables: ['x'],
    values: [value],
    matrix: [[1]],
    rhs: [0],
    residuals: [0],
    maxResidual: 0,
    condition: 1,
    conditionNorm: 'infinity',
    engine: 'javascript',
    durationMs: 0,
    warnings: [],
  }
}

describe('selected real-root continuation', () => {
  let search: Awaited<ReturnType<typeof createAutomaticSolver>>
  beforeAll(async () => {
    search = await createAutomaticSolver(
      await readFile(new URL('../public/solver.wasm', import.meta.url)),
    )
  })

  it.each([-1, 1])(
    'follows the selected %s square-root branch in both directions',
    (sign) => {
      const source = 'x^2 = p'
      const parameters = { p: 4 }
      const selected = search(source, parameters).solutions.find(
        (solution) => Math.sign(solution.values[0]) === sign,
      )!
      const result = computeBranchSweeps(
        search.solveNear,
        source,
        parameters,
        {
          name: 'p',
          min: 1,
          max: 9,
          step: 1,
          steps: 81,
        },
        selected,
      )
      expect(result.sweep).toHaveLength(81)
      expect(result.dataset.map((point) => point.parameter)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9,
      ])
      for (const point of [...result.sweep, ...result.dataset]) {
        expect(point.error).toBeUndefined()
        expect(point.values?.[0]).toBeCloseTo(
          sign * Math.sqrt(point.parameter),
          7,
        )
      }
      expect(result.datasetError).toBeUndefined()
    },
  )

  it.each([-1, 1])(
    'keeps gaps after the %s branch disappears instead of switching roots',
    (sign) => {
      const source = 'x^2 = p'
      const parameters = { p: 1 }
      const selected = search(source, parameters).solutions.find(
        (solution) => Math.sign(solution.values[0]) === sign,
      )!
      const result = computeBranchSweeps(
        search.solveNear,
        source,
        parameters,
        {
          name: 'p',
          min: -1,
          max: 1,
          step: 0.25,
          steps: 81,
        },
        selected,
      )
      for (const point of result.dataset) {
        if (point.parameter < 0) {
          expect(point.values).toBeNull()
          expect(point.error).toContain('분기')
        } else {
          expect(point.error).toBeUndefined()
          expect(point.values?.[0]).toBeCloseTo(
            sign * Math.sqrt(point.parameter),
            5,
          )
        }
      }
      expect(
        result.sweep
          .filter((point) => point.parameter < 0)
          .every((point) => point.values === null),
      ).toBe(true)
    },
  )

  it('allows a continuous branch to cross zero', () => {
    const result = computeBranchSweeps(
      search.solveNear,
      'x = p',
      { p: 0.6 },
      {
        name: 'p',
        min: -1,
        max: 1,
        step: 0.4,
        steps: 6,
      },
      search('x = p', { p: 0.6 }).solutions[0],
    )
    for (const point of [...result.sweep, ...result.dataset]) {
      expect(point.values?.[0]).toBeCloseTo(point.parameter, 9)
      expect(point.error).toBeUndefined()
    }
  })

  const periodicPhases = [
    0,
    Math.PI / 2,
    -13 * Math.PI,
    -13 * Math.PI + Math.PI / 2,
    13 * Math.PI,
    -26 * Math.PI,
    26 * Math.PI,
  ]
  it.each(periodicPhases)(
    'keeps the analytic periodic family at x=%s, including folds and missing real roots',
    (phase) => {
      const source = 'sin(x)*cos(x)=target'
      const sign = Math.cos(2 * phase) > 0 ? 1 : -1
      const expected = (target: number) =>
        phase + (sign * Math.asin(2 * target)) / 2
      const parameters = { target: 0.25 }
      const selected = search.solveNear(source, parameters, [expected(0.25)])
      for (const [min, max] of [
        [0, 1],
        [-0.5, 0.5],
        [-1, 1],
      ]) {
        const result = computeBranchSweeps(
          search.solveNear,
          source,
          parameters,
          { name: 'target', min, max, step: 0.025, steps: 81 },
          selected,
        )
        for (const point of [...result.sweep, ...result.dataset]) {
          if (Math.abs(point.parameter) > 0.5 + 1e-14) {
            expect(point.values).toBeNull()
            expect(point.error).toContain('분기')
          } else {
            expect(point.error).toBeUndefined()
            expect(point.values?.[0]).toBeCloseTo(expected(point.parameter), 6)
            expect(
              Math.abs(
                Math.sin(point.values![0]) * Math.cos(point.values![0]) -
                  point.parameter,
              ),
            ).toBeLessThan(1e-9)
          }
        }
      }
    },
  )

  it.each([1e-12, 1e9])('preserves valid branches at the scale %s', (scale) => {
    const source = 'x=scale*p'
    const parameters = { scale, p: 0.6 }
    const result = computeBranchSweeps(
      search.solveNear,
      source,
      parameters,
      { name: 'p', min: -1, max: 1, step: 0.4, steps: 6 },
      search(source, parameters).solutions[0],
    )
    for (const point of [...result.sweep, ...result.dataset]) {
      expect(point.error).toBeUndefined()
      expect(point.values![0] / scale).toBeCloseTo(point.parameter, 8)
    }
  })

  it.each([1e-12, 40])(
    'rejects same-sign branch jumps at the scale %s',
    (offset) => {
      const near: NearSolver = (_source, parameters) =>
        root(parameters.p < 0.5 ? offset : offset * 1.05)
      const result = computeBranchSweeps(
        near,
        'periodic model',
        { p: 1 },
        { name: 'p', min: 0, max: 1, step: 0.25, steps: 5 },
        root(offset * 1.05),
      )
      expect(result.dataset.map((point) => point.values?.[0] ?? null)).toEqual([
        null,
        null,
        offset * 1.05,
        offset * 1.05,
        offset * 1.05,
      ])
    },
  )

  it('does not reconnect a branch after a pole or a region without real roots', () => {
    for (const source of ['x=1/p', 'x^2=p*(p-1)']) {
      const parameters = { p: 2 }
      const result = computeBranchSweeps(
        search.solveNear,
        source,
        parameters,
        { name: 'p', min: -1, max: 2, step: 0.25, steps: 13 },
        search(source, parameters).solutions[0],
      )
      for (const point of result.dataset) {
        if (source === 'x=1/p' ? point.parameter <= 0 : point.parameter < 1)
          expect(point.values).toBeNull()
        else expect(point.error).toBeUndefined()
      }
    }
  })

  it('continues pinned roots through all parameter changes and computes final diagnostics', () => {
    const source = 'x^2=a+b'
    const origin = { a: 2, b: 2 }
    const selected = search(source, origin).solutions.find(
      (result) => result.values[0] < 0,
    )!
    const continued = continueRoot(
      search.solveNear,
      source,
      origin,
      { a: 5, b: 4 },
      selected,
      { conditionNorm: '2' },
    )
    expect(continued.values[0]).toBeCloseTo(-3, 9)
    expect(continued.condition).toBe(1)
    expect(continued.conditionNorm).toBe('2')
    expect(
      continueRoot(search.solveNear, source, origin, origin, selected)
        .condition,
    ).toBe(1)
    expect(() =>
      continueRoot(search.solveNear, source, origin, { a: 2, c: 2 }, selected),
    ).toThrow('파라미터')
  })

  it('subdivides parameter steps when a local solver cannot reach the next sample', () => {
    const near: NearSolver = (_source, parameters, seed) => {
      const value = Array.isArray(seed) ? seed[0] : seed.values[0]
      if (Math.abs(parameters.p - value) > 0.15)
        throw new Error('local step too large')
      return root(parameters.p)
    }
    const result = computeBranchSweeps(
      near,
      'x=p',
      { p: 0 },
      {
        name: 'p',
        min: 0,
        max: 1,
        step: 0.5,
        steps: 3,
      },
      root(0),
    )
    expect(result.dataset.map((point) => point.values?.[0])).toEqual([
      0, 0.5, 1,
    ])
  })

  it('rejects a corrector that jumps to another root', () => {
    const near: NearSolver = (_source, parameters) =>
      root(parameters.p < 0.5 ? 1 : -1)
    const result = computeBranchSweeps(
      near,
      'x^2=1',
      { p: 1 },
      {
        name: 'p',
        min: 0,
        max: 1,
        step: 0.25,
        steps: 5,
      },
      root(-1),
    )
    expect(result.dataset.map((point) => point.values?.[0] ?? null)).toEqual([
      null,
      null,
      -1,
      -1,
      -1,
    ])
    expect(result.dataset[0].error).toContain('분기')
  })

  it('shares point values between graph and table without solving other roots', () => {
    const near = vi.fn<NearSolver>((_source, parameters) =>
      root(parameters.p / 100),
    )
    const result = computeBranchSweeps(
      near,
      'x=p/100',
      { p: 0 },
      {
        name: 'p',
        min: 0,
        max: 1,
        step: 0.5,
        steps: 3,
      },
      root(0),
    )
    // The shared last endpoint needs only one forward correction. Reverse
    // validation can make additional calls at previously visited parameters.
    expect(near.mock.calls.filter((call) => call[1].p === 1)).toHaveLength(1)
    expect(result.dataset[0]).toBe(result.sweep[0])
    expect(result.dataset[1]).toBe(result.sweep[1])
    expect(result.dataset[2]).toBe(result.sweep[2])
    expect(
      near.mock.calls.every((call) => call[3]?.computeCondition === false),
    ).toBe(true)
  })

  it('keeps graph output when the nonlinear dataset exceeds its 500-row limit', () => {
    const near: NearSolver = (_source, parameters) => root(parameters.p / 100)
    const result = computeBranchSweeps(
      near,
      'x=p/100',
      { p: 0 },
      {
        name: 'p',
        min: 0,
        max: 1,
        step: 0.001,
        steps: 81,
        maxPoints: 2000,
      },
      root(0),
    )
    expect(result.sweep).toHaveLength(81)
    expect(result.dataset).toEqual([])
    expect(result.datasetError).toContain('500행')
  })

  it('handles disabled sweeps and rejects invalid active ranges', () => {
    const near = vi.fn<NearSolver>()
    expect(computeBranchSweeps(near, '', {}, null, root(1))).toEqual({
      sweep: [],
      dataset: [],
      sweepName: '',
    })
    expect(() =>
      computeBranchSweeps(
        near,
        '',
        { p: 1 },
        {
          name: 'p',
          min: 1,
          max: 1,
          step: 1,
          steps: 81,
        },
        root(1),
      ),
    ).toThrow('범위')
    expect(near).not.toHaveBeenCalled()
  })
})

describe('automatic worker requests', () => {
  let scope: {
    onmessage?: (event: MessageEvent) => void
    postMessage: ReturnType<typeof vi.fn>
  }
  const summary = {
    method: 'test',
    min: -100,
    max: 100,
    attempts: 2,
    note: 'bounded search',
  }
  let automatic: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    scope = { postMessage: vi.fn() }
    vi.stubGlobal('self', scope)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('test uses JS fallback')
      }),
    )
    automatic = Object.assign(
      vi.fn((source: string) => ({
        solutions: source === 'no roots' ? [] : [root(-1), root(1)],
        search: summary,
      })),
      { solveNear: vi.fn<NearSolver>() },
    )
    vi.doMock('../src/engine/automatic', () => ({
      createAutomaticSolver: async () => automatic,
    }))
    await import('../src/engine/solver.worker')
  })

  afterEach(() => {
    vi.doUnmock('../src/engine/automatic')
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.resetModules()
  })

  function send(request: Record<string, unknown>) {
    scope.onmessage!({
      data: {
        id: 1,
        mode: 'nonlinear',
        source: 'x^2=1',
        parameters: {},
        sweep: null,
        ...request,
      },
    } as MessageEvent)
  }

  it('selects another cached root without repeating the search and invalidates changed search options', async () => {
    send({ parameters: { b: 2, a: 1 } })
    await vi.runAllTimersAsync()
    expect(scope.postMessage.mock.lastCall?.[0].payload.result.values).toEqual([
      -1,
    ])
    send({ id: 2, solutionIndex: 1, parameters: { a: 1, b: 2 } })
    await vi.runAllTimersAsync()
    expect(automatic).toHaveBeenCalledTimes(1)
    expect(scope.postMessage.mock.lastCall?.[0]).toMatchObject({
      id: 2,
      ok: true,
      payload: {
        selectedSolution: 1,
        result: { values: [1] },
        solutions: [{ values: [-1] }, { values: [1] }],
      },
    })
    send({ id: 3, parameters: { a: 1, b: 2 }, conditionNorm: '2' })
    await vi.runAllTimersAsync()
    send({
      id: 4,
      parameters: { a: 1, b: 2 },
      conditionNorm: '2',
      searchBounds: { min: -5, max: 5 },
    })
    await vi.runAllTimersAsync()
    expect(automatic).toHaveBeenCalledTimes(3)
  })

  it('coalesces queued input and reports failed coverage without a fabricated result', async () => {
    send({ id: 1, source: 'intermediate 1' })
    send({ id: 2, source: 'intermediate 2' })
    send({ id: 3, source: 'no roots' })
    await vi.runAllTimersAsync()
    expect(automatic).toHaveBeenCalledTimes(1)
    expect(automatic.mock.calls[0][0]).toBe('no roots')
    expect(scope.postMessage).toHaveBeenCalledTimes(1)
    const response = scope.postMessage.mock.lastCall?.[0]
    expect(response).toMatchObject({ id: 3, ok: false, search: summary })
    expect(response.error).toContain('실수 해를 찾지 못했습니다')
    expect(response.payload).toBeUndefined()
  })

  it('keeps linear solving and manual expression evaluation available', async () => {
    send({ mode: 'linear', source: '2*x=6' })
    await vi.runAllTimersAsync()
    expect(scope.postMessage.mock.lastCall?.[0].payload.result.values).toEqual([
      3,
    ])
    send({ id: 2, nonlinearSearch: 'manual', source: 'a=1\nb=4\nx=a+b^2\nx+2' })
    await vi.runAllTimersAsync()
    expect(scope.postMessage.mock.lastCall?.[0].payload.result).toMatchObject({
      kind: 'evaluation',
      values: [1, 4, 17, 19],
    })
    expect(automatic).not.toHaveBeenCalled()
  })
})
