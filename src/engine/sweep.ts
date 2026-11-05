import {
  ModelError,
  type SolvePayload,
  type SolveResult,
  type SweepPoint,
} from './index'

export const MAX_DATASET_POINTS = 2000

export type SweepSettings = {
  name: string
  min: number
  max: number
  /** Uniform rendering samples; independent from the tabulated interval. */
  steps: number
  /** User-selected interval for the table and CSV dataset. */
  step: number
}

/** Represent the user's decimal inputs on one integer lattice, avoiding drift
 * from repeated floating-point addition (for example 0.2 + 0.01 + ...). */
function decimalParts(value: number): {
  coefficient: bigint
  exponent: number
} {
  const [mantissa, power = '0'] = value.toString().split('e')
  const [whole, fraction = ''] = mantissa.split('.')
  return {
    coefficient: BigInt(whole + fraction),
    exponent: Number(power) - fraction.length,
  }
}

export function parameterValues(
  min: number,
  max: number,
  step: number,
  limit = MAX_DATASET_POINTS,
): number[] {
  if (![min, max, step].every(Number.isFinite) || min >= max || step <= 0)
    throw new ModelError(
      '데이터 간격은 0보다 큰 유한한 숫자여야 하며, 최솟값은 최댓값보다 작아야 합니다.',
    )
  if (!Number.isSafeInteger(limit) || limit < 2)
    throw new ModelError('데이터 행 수의 상한은 2 이상의 정수여야 합니다.')

  const parts = [min, max, step].map(decimalParts)
  const exponent = Math.min(...parts.map((part) => part.exponent))
  const [start, end, interval] = parts.map(
    (part) => part.coefficient * 10n ** BigInt(part.exponent - exponent),
  )
  const span = end - start
  const intervals = span / interval
  const remainder = span % interval
  const toNumber = (units: bigint) => Number(`${units}e${exponent}`)

  // A computed endpoint such as 0.1 + 0.2 can be one ULP above 0.3.
  // In that case use the exact supplied maximum once, not a phantom extra row.
  const lastRegular = toNumber(start + intervals * interval)
  const endpointTolerance = Math.min(
    Number.EPSILON *
      4 *
      Math.max(Math.abs(lastRegular), Math.abs(max), Math.abs(step)),
    Math.abs(step) * 1e-9,
  )
  const endsAtMaximum =
    remainder === 0n ||
    (intervals > 0n && Math.abs(max - lastRegular) <= endpointTolerance)
  const rowCount = intervals + (endsAtMaximum ? 1n : 2n)
  if (rowCount > BigInt(limit))
    throw new ModelError(
      `현재 간격의 데이터는 최대 ${limit.toLocaleString('ko-KR')}행을 초과합니다. 간격을 키우거나 범위를 줄여 주세요. 설정 간격은 자동으로 변경하지 않습니다.`,
    )

  const values: number[] = []
  for (let i = 0; i <= Number(intervals); i++) {
    const value =
      endsAtMaximum && i === Number(intervals)
        ? max
        : toNumber(start + BigInt(i) * interval)
    if (
      !Number.isFinite(value) ||
      (values.length > 0 && value <= values[values.length - 1])
    )
      throw new ModelError(
        '설정 간격이 현재 숫자의 정밀도보다 작습니다. 간격을 키우거나 범위를 조정해 주세요.',
      )
    values.push(value)
  }
  if (!endsAtMaximum) {
    if (max <= values[values.length - 1])
      throw new ModelError(
        '설정 간격으로 서로 다른 데이터 지점을 표현할 수 없습니다. 간격을 조정해 주세요.',
      )
    values.push(max)
  }
  return values
}

type Solver = (
  source: string,
  parameters: Record<string, number>,
) => SolveResult
type Sweeps = Pick<
  SolvePayload,
  'sweep' | 'dataset' | 'datasetError' | 'sweepName'
>

/** Graph density stays stable while the table and CSV preserve the user's step. */
export function computeSweeps(
  solve: Solver,
  source: string,
  parameters: Record<string, number>,
  settings: SweepSettings | null,
): Sweeps {
  if (!settings) return { sweep: [], dataset: [], sweepName: '' }
  const { name, min, max, steps, step } = settings
  if (
    !Object.hasOwn(parameters, name) ||
    ![min, max, steps].every(Number.isFinite) ||
    max <= min
  )
    throw new ModelError('시뮬레이션 파라미터와 범위를 확인해 주세요.')

  const cache = new Map<number, SweepPoint>()
  const pointAt = (parameter: number): SweepPoint => {
    const cached = cache.get(parameter)
    if (cached) return cached
    let point: SweepPoint
    try {
      point = {
        parameter,
        values: solve(source, { ...parameters, [name]: parameter }).values,
      }
    } catch (error) {
      point = {
        parameter,
        values: null,
        error: error instanceof Error ? error.message : '계산 실패',
      }
    }
    cache.set(parameter, point)
    return point
  }

  const graphCount = Math.min(201, Math.max(2, Math.round(steps)))
  const sweep = Array.from({ length: graphCount }, (_, i) => {
    const fraction = i / (graphCount - 1)
    return pointAt(min * (1 - fraction) + max * fraction)
  })
  try {
    return {
      sweep,
      dataset: parameterValues(min, max, step).map(pointAt),
      sweepName: name,
    }
  } catch (error) {
    return {
      sweep,
      dataset: [],
      datasetError:
        error instanceof Error
          ? error.message
          : '데이터를 생성하지 못했습니다.',
      sweepName: name,
    }
  }
}
