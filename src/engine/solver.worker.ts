/// <reference lib="webworker" />
import {
  createSolver,
  ModelError,
  type SolvePayload,
  type SweepPoint,
} from './index'
type Request = {
  id: number
  source: string
  parameters: Record<string, number>
  sweep: { name: string; min: number; max: number; steps: number } | null
}
const ready = createSolver()
self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, source, parameters, sweep } = event.data
  try {
    const solve = await ready
    const result = solve(source, parameters)
    const points: SweepPoint[] = []
    if (sweep) {
      if (
        !Object.hasOwn(parameters, sweep.name) ||
        !Number.isFinite(sweep.min) ||
        !Number.isFinite(sweep.max) ||
        !Number.isFinite(sweep.steps) ||
        sweep.max <= sweep.min
      )
        throw new ModelError('시뮬레이션 파라미터와 범위를 확인해 주세요.')
      const steps = Math.min(201, Math.max(2, Math.round(sweep.steps)))
      for (let i = 0; i < steps; i++) {
        const fraction = i / (steps - 1)
        // Convex interpolation remains finite even when max - min would overflow.
        const parameter = sweep.min * (1 - fraction) + sweep.max * fraction
        try {
          points.push({
            parameter,
            values: solve(source, { ...parameters, [sweep.name]: parameter })
              .values,
          })
        } catch (error) {
          points.push({
            parameter,
            values: null,
            error: error instanceof Error ? error.message : '계산 실패',
          })
        }
      }
    }
    const payload: SolvePayload = {
      result,
      sweep: points,
      sweepName: sweep?.name ?? '',
    }
    self.postMessage({ id, ok: true, payload })
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error:
        error instanceof Error ? error.message : '계산 중 오류가 발생했습니다.',
      line: error instanceof ModelError ? error.line : undefined,
    })
  }
}
