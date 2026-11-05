/// <reference lib="webworker" />
import {
  createSolver,
  ModelError,
  type SolvePayload,
  type ConditionNorm,
} from './index'
import { computeSweeps, type SweepSettings } from './sweep'
type Request = {
  id: number
  source: string
  parameters: Record<string, number>
  sweep: SweepSettings | null
  conditionNorm?: ConditionNorm
}
const ready = createSolver()
self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, source, parameters, sweep, conditionNorm } = event.data
  try {
    const solve = await ready
    const result = solve(source, parameters, { conditionNorm })
    const payload: SolvePayload = {
      result,
      ...computeSweeps(solve, source, parameters, sweep),
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
