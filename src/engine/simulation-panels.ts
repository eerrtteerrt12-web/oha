import {
  ModelError,
  type ConditionNorm,
  type SimulationAnchor,
  type SimulationPanel,
  type SolveResult,
} from './index'
import { computeBranchSweeps, continueRoot, type NearSolver } from './branches'
import type { SweepSettings } from './sweep'

export const MAX_SIMULATION_PANELS = 6
const MAX_CACHED_PANELS = 48

const sortedParameters = (parameters: Record<string, number>) =>
  Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b))

function validateAnchor(
  anchor: SimulationAnchor,
  parameters: Record<string, number>,
) {
  if (
    !anchor ||
    typeof anchor.id !== 'string' ||
    !anchor.id ||
    typeof anchor.label !== 'string' ||
    !Array.isArray(anchor.variables) ||
    !anchor.variables.length ||
    anchor.variables.length > 64 ||
    Array.from(anchor.variables).some(
      (name) =>
        typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name),
    ) ||
    new Set(anchor.variables).size !== anchor.variables.length ||
    !Array.isArray(anchor.values) ||
    anchor.values.length !== anchor.variables.length ||
    !Array.from(anchor.values).every(Number.isFinite) ||
    !anchor.parameters ||
    typeof anchor.parameters !== 'object' ||
    Array.isArray(anchor.parameters) ||
    !Object.values(anchor.parameters).every(Number.isFinite)
  )
    throw new ModelError('선택한 해의 저장 정보를 확인해 주세요.')

  const originNames = Object.keys(anchor.parameters).sort()
  const currentNames = Object.keys(parameters).sort()
  if (
    !Object.values(parameters).every(Number.isFinite) ||
    originNames.length !== currentNames.length ||
    originNames.some((name, i) => name !== currentNames[i])
  )
    throw new ModelError('파라미터가 변경되었습니다. 해를 다시 선택해 주세요.')
}

function matchesAnchor(result: SolveResult, anchor: SimulationAnchor) {
  return (
    result.variables.length === anchor.variables.length &&
    result.values.length === anchor.values.length &&
    result.variables.every((name, i) => name === anchor.variables[i]) &&
    result.values.every(
      (value, i) =>
        Number.isFinite(value) &&
        Math.abs(value - anchor.values[i]) <=
          1e-9 *
            Math.max(
              Number.MIN_VALUE,
              Math.abs(value),
              Math.abs(anchor.values[i]),
            ),
    )
  )
}

/** Each panel owns an immutable root and parameter snapshot. Following that
 * snapshot, rather than a global result index, keeps its identity when roots
 * change order or leave the global search window. */
export function createSimulationPanelComputer(solveNear: NearSolver) {
  const cache = new Map<string, SimulationPanel>()

  return (
    source: string,
    parameters: Record<string, number>,
    sweep: SweepSettings | null,
    anchors: SimulationAnchor[],
    conditionNorm: ConditionNorm = 'infinity',
  ): SimulationPanel[] => {
    if (!Array.isArray(anchors) || anchors.length > MAX_SIMULATION_PANELS)
      throw new ModelError(
        `동시에 탐색할 수 있는 해는 최대 ${MAX_SIMULATION_PANELS}개입니다.`,
      )
    if (
      Array.from(anchors).some(
        (anchor) => !anchor || typeof anchor.id !== 'string',
      ) ||
      new Set(anchors.map((anchor) => anchor.id)).size !== anchors.length
    )
      throw new ModelError('시뮬레이션의 해 식별자가 올바르지 않습니다.')

    return anchors.map((anchor) => {
      const empty = {
        id: anchor.id,
        label: anchor.label,
        result: null,
        sweep: [],
        dataset: [],
        sweepName: sweep?.name ?? '',
      }
      try {
        validateAnchor(anchor, parameters)
        const key = JSON.stringify([
          source,
          anchor.id,
          anchor.label,
          anchor.variables,
          anchor.values,
          sortedParameters(anchor.parameters),
          sortedParameters(parameters),
          sweep
            ? [
                sweep.name,
                sweep.min,
                sweep.max,
                sweep.steps,
                sweep.step,
                sweep.maxPoints ?? 500,
              ]
            : null,
          conditionNorm,
        ])
        const cached = cache.get(key)
        if (cached) {
          cache.delete(key)
          cache.set(key, cached)
          return cached
        }

        let panel: SimulationPanel
        let verifiedOrigin: SolveResult | undefined
        try {
          // Re-evaluate the pinned state first so an obsolete model cannot
          // silently turn a saved root into an unrelated starting point.
          const origin = solveNear(
            source,
            anchor.parameters,
            [...anchor.values],
            {
              computeCondition: false,
            },
          )
          if (!matchesAnchor(origin, anchor))
            throw new ModelError(
              '저장한 해가 현재 수식과 다릅니다. 해를 다시 선택해 주세요.',
            )
          verifiedOrigin = origin
          const result = continueRoot(
            solveNear,
            source,
            anchor.parameters,
            parameters,
            origin,
            { conditionNorm },
          )
          panel = {
            id: anchor.id,
            label: anchor.label,
            result,
            ...computeBranchSweeps(
              solveNear,
              source,
              parameters,
              sweep ? { ...sweep, maxPoints: 500 } : null,
              result,
            ),
          }
        } catch (error) {
          panel = {
            ...empty,
            error: `선택한 해의 분기를 현재 설정까지 추적할 수 없습니다. ${error instanceof Error ? error.message : '계산 실패'}`,
          }
          if (
            verifiedOrigin &&
            sweep &&
            Object.hasOwn(anchor.parameters, sweep.name)
          ) {
            try {
              // The current sweep value may lie beyond a fold. Keep the
              // reachable part of this same branch visible, with every other
              // parameter at its current value and no fabricated current root.
              const referenceParameters = {
                ...parameters,
                [sweep.name]: anchor.parameters[sweep.name],
              }
              const reference = continueRoot(
                solveNear,
                source,
                anchor.parameters,
                referenceParameters,
                verifiedOrigin,
                { conditionNorm, computeCondition: false },
              )
              panel = {
                ...panel,
                ...computeBranchSweeps(
                  solveNear,
                  source,
                  referenceParameters,
                  { ...sweep, maxPoints: 500 },
                  reference,
                ),
              }
            } catch {
              // If the anchor cannot reach the other current parameters,
              // there is no safe reference from which to show this branch.
            }
          }
        }
        if (cache.size >= MAX_CACHED_PANELS)
          cache.delete(cache.keys().next().value!)
        cache.set(key, panel)
        return panel
      } catch (error) {
        return {
          ...empty,
          error:
            error instanceof Error
              ? error.message
              : '해를 불러오지 못했습니다.',
        }
      }
    })
  }
}
