/// <reference lib="webworker" />
import {
  createSolver,
  ModelError,
  type SolvePayload,
  type ConditionNorm,
} from './index'
import { computeSweeps, type SweepSettings } from './sweep'
import { createNonlinearSolver } from './nonlinear'
import { createAutomaticSolver, type AutomaticSearchResult } from './automatic'
import { computeBranchSweeps } from './branches'
type Request = {
  id: number
  source: string
  parameters: Record<string, number>
  sweep: SweepSettings | null
  conditionNorm?: ConditionNorm
  mode?: 'linear' | 'nonlinear'
  nonlinearSearch?: 'auto' | 'manual'
  searchBounds?: { min: number; max: number }
  solutionIndex?: number
}
const ready = createSolver()
const nonlinearReady = createNonlinearSolver()
let automaticReady: ReturnType<typeof createAutomaticSolver> | undefined
const searches = new Map<string, AutomaticSearchResult>()
let pendingRequest: Request | undefined
let processing = false

// Yield between calculations so queued slider events replace each other rather
// than starting an expensive global root search for every intermediate value.
self.onmessage = (event: MessageEvent<Request>) => {
  pendingRequest = event.data
  if (!processing) {
    processing = true
    setTimeout(processLatest, 0)
  }
}

async function processLatest() {
  const request = pendingRequest!
  pendingRequest = undefined
  try {
    await handleRequest(request)
  } finally {
    if (pendingRequest) setTimeout(processLatest, 0)
    else processing = false
  }
}

async function handleRequest(request: Request) {
  const {
    id,
    source,
    parameters,
    sweep,
    conditionNorm,
    mode,
    nonlinearSearch,
    searchBounds,
    solutionIndex,
  } = request
  try {
    if (mode === 'nonlinear' && nonlinearSearch !== 'manual') {
      automaticReady ??= createAutomaticSolver()
      const search = await automaticReady
      if (pendingRequest) return
      const key = JSON.stringify([
        source,
        Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b)),
        conditionNorm ?? 'infinity',
        searchBounds ? [searchBounds.min, searchBounds.max] : null,
      ])
      let found = searches.get(key)
      if (!found) {
        found = search(source, parameters, { conditionNorm, searchBounds })
        if (searches.size >= 8) searches.delete(searches.keys().next().value!)
        searches.set(key, found)
      }
      if (!found.solutions.length) {
        self.postMessage({
          id,
          ok: false,
          error:
            '자동 탐색 범위에서 실수 해를 찾지 못했습니다. 수식을 확인하거나 고급 설정에서 탐색 범위를 조정해 주세요. 일반적인 수치 탐색은 모든 실수 해의 존재 여부를 판정하지 못합니다.',
          search: found.search,
        })
        return
      }
      const selectedSolution =
        Number.isInteger(solutionIndex) && solutionIndex! >= 0
          ? Math.min(solutionIndex!, found.solutions.length - 1)
          : 0
      const result = found.solutions[selectedSolution]
      const payload: SolvePayload = {
        result,
        solutions: found.solutions,
        selectedSolution,
        search: found.search,
        ...computeBranchSweeps(
          search.solveNear,
          source,
          parameters,
          sweep ? { ...sweep, maxPoints: 500 } : null,
          result,
        ),
      }
      self.postMessage({ id, ok: true, payload })
      return
    }
    const solve = await (mode === 'nonlinear' ? nonlinearReady : ready)
    if (pendingRequest) return
    const result = solve(source, parameters, { conditionNorm })
    const payload: SolvePayload = {
      result,
      ...computeSweeps(
        solve,
        source,
        parameters,
        mode === 'nonlinear' && sweep ? { ...sweep, maxPoints: 500 } : sweep,
      ),
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
