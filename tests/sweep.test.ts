import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import { createSolver } from '../src/engine'
import {
  computeSweeps,
  MAX_DATASET_POINTS,
  parameterValues,
} from '../src/engine/sweep'

describe('parameter interval dataset', () => {
  it('uses the configured decimal interval rather than graph sample density', () => {
    const values = parameterValues(0.2, 0.8, 0.01)
    expect(values).toHaveLength(61)
    expect(values.slice(0, 4)).toEqual([0.2, 0.21, 0.22, 0.23])
    expect(values.slice(-2)).toEqual([0.79, 0.8])
  })
  it('includes an unaligned maximum once with a shorter final interval', () => {
    expect(parameterValues(0, 1, 0.3)).toEqual([0, 0.3, 0.6, 0.9, 1])
    expect(parameterValues(-0.25, 0.35, 0.2)).toEqual([
      -0.25, -0.05, 0.15, 0.35,
    ])
  })
  it('handles negative ranges and scientific notation without accumulated drift', () => {
    expect(parameterValues(-0.03, 0.01, 0.01)).toEqual([
      -0.03, -0.02, -0.01, 0, 0.01,
    ])
    expect(parameterValues(1e-8, 5e-8, 1e-8)).toEqual([
      1e-8, 2e-8, 3e-8, 4e-8, 5e-8,
    ])
  })
  it('uses both range endpoints when the interval is larger than the range', () => {
    expect(parameterValues(2, 3, 10)).toEqual([2, 3])
  })
  it('avoids a phantom final row from floating endpoint arithmetic', () => {
    expect(parameterValues(0, 0.1 + 0.2, 0.1)).toEqual([0, 0.1, 0.2, 0.1 + 0.2])
    expect(parameterValues(0, 0.3, 0.1)).toEqual([0, 0.1, 0.2, 0.3])
  })
  it.each([0, -0.1, NaN, Infinity])(
    'rejects an invalid interval %s',
    (step) => {
      expect(() => parameterValues(0, 1, step)).toThrow('데이터 간격')
    },
  )
  it('rejects invalid range endpoints', () => {
    expect(() => parameterValues(1, 1, 0.1)).toThrow()
    expect(() => parameterValues(1, -1, 0.1)).toThrow()
    expect(() => parameterValues(0, Infinity, 0.1)).toThrow()
  })
  it('checks the full row count including an appended maximum before computing', () => {
    expect(parameterValues(0, 1, 0.5, 3)).toEqual([0, 0.5, 1])
    expect(() => parameterValues(0, 1, 0.3, 4)).toThrow('최대 4행')
    expect(() => parameterValues(0, 1, Number.MIN_VALUE)).toThrow('초과')
    expect(parameterValues(0, MAX_DATASET_POINTS - 1, 1)).toHaveLength(
      MAX_DATASET_POINTS,
    )
  })
  it('keeps an actual short final interval at large offsets', () => {
    expect(parameterValues(1, 1.0000000000000007, 4e-16)).toEqual([
      1, 1.0000000000000004, 1.0000000000000007,
    ])
  })
  it('rejects a grid whose distinct values cannot be represented in floating point', () => {
    expect(() => parameterValues(1, 1.000000000000001, 1e-16)).toThrow('정밀도')
  })
  it('keeps tiny/subnormal and large signed ranges finite and ordered', () => {
    expect(parameterValues(0, 1e-323, 5e-324)).toEqual([0, 5e-324, 1e-323])
    expect(parameterValues(-1e308, 1e308, 1e308)).toEqual([-1e308, 0, 1e308])
  })
})

describe('independent graph and table calculations with the real WASM solver', () => {
  let solve: Awaited<ReturnType<typeof createSolver>>
  beforeAll(async () => {
    solve = await createSolver(
      await readFile(new URL('../public/solver.wasm', import.meta.url)),
    )
  })
  it('preserves 81 graph samples and emits 61 configured table samples', () => {
    const sweeps = computeSweeps(
      solve,
      'x + y = F\nc_A*x + c_B*y = c_T*F',
      { F: 100, c_A: 0.2, c_B: 0.8, c_T: 0.5 },
      { name: 'c_T', min: 0.2, max: 0.8, steps: 81, step: 0.01 },
    )
    expect(sweeps.sweep).toHaveLength(81)
    expect(sweeps.dataset).toHaveLength(61)
    expect(sweeps.dataset[1].parameter).toBe(0.21)
    expect(sweeps.dataset[1].values?.[0]).toBeCloseTo(98.3333333333, 8)
    expect(sweeps.dataset[1].values?.[1]).toBeCloseTo(1.6666666667, 8)
    expect(sweeps.datasetError).toBeUndefined()
  })
  it('preserves singular data points as explicit gaps rather than omitting rows', () => {
    const sweeps = computeSweeps(
      solve,
      'k*x = 1',
      { k: 1 },
      { name: 'k', min: -1, max: 1, steps: 81, step: 0.5 },
    )
    expect(sweeps.dataset.map((p) => p.parameter)).toEqual([
      -1, -0.5, 0, 0.5, 1,
    ])
    expect(sweeps.dataset[2].values).toBeNull()
    expect(sweeps.dataset[2].error).toContain('해가 없습니다')
    expect(sweeps.dataset[3].values).toEqual([2])
  })
  it('keeps the graph available if the dataset interval would exceed the cap', () => {
    const sweeps = computeSweeps(
      solve,
      'x = k',
      { k: 1 },
      { name: 'k', min: 0, max: 1, steps: 81, step: 0.000001 },
    )
    expect(sweeps.sweep).toHaveLength(81)
    expect(sweeps.dataset).toEqual([])
    expect(sweeps.datasetError).toContain('2,000행')
  })
  it('keeps graph output available when a dataset interval is invalid', () => {
    const sweeps = computeSweeps(
      solve,
      'x = k',
      { k: 1 },
      { name: 'k', min: 0, max: 1, steps: 81, step: 0 },
    )
    expect(sweeps.sweep).toHaveLength(81)
    expect(sweeps.dataset).toEqual([])
    expect(sweeps.datasetError).toContain('데이터 간격')
  })
  it('returns no sweep rows when the model has no parameters', () => {
    expect(computeSweeps(solve, 'x = 1', {}, null)).toEqual({
      sweep: [],
      dataset: [],
      sweepName: '',
    })
  })
})
