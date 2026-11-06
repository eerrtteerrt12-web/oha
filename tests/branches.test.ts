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
import { computeBranchSweeps, type NearSolver } from '../src/engine/branches'
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
    expect(near).toHaveBeenCalledTimes(2)
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
