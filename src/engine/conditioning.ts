import { Matrix, SingularValueDecomposition } from 'ml-matrix'

export type ConditionNorm = 'infinity' | '2'
export type ConditionAssessment = {
  level: 'stable' | 'sensitive' | 'very-sensitive' | 'unavailable'
  label: string
  description: string
}
export const CONDITION_THRESHOLDS = {
  sensitive: 1e4,
  verySensitive: 1e8,
} as const

/** Heuristic sensitivity bands, not a guarantee about solution accuracy.
 * Input precision, units and the chosen norm must be considered separately. */
export function classifyCondition(value: number): ConditionAssessment {
  if (Number.isNaN(value) || value < 1)
    return {
      level: 'unavailable',
      label: '판정 불가',
      description:
        '조건수를 계산하지 못했습니다. 해와 잔차를 별도로 확인해 주세요.',
    }
  if (value >= CONDITION_THRESHOLDS.verySensitive)
    return {
      level: 'very-sensitive',
      label: '매우 민감',
      description:
        '입력값의 작은 오차가 해에 크게 증폭될 수 있습니다. 입력 정밀도와 단위·스케일을 점검하세요.',
    }
  if (value >= CONDITION_THRESHOLDS.sensitive)
    return {
      level: 'sensitive',
      label: '민감',
      description:
        '입력 오차가 증폭될 수 있습니다. 입력값의 유효숫자와 결과의 잔차를 함께 확인하세요.',
    }
  return {
    level: 'stable',
    label: '안정',
    description:
      '이 기준에서는 오차 증폭 가능성이 비교적 낮습니다. 실제 정확도는 입력 정밀도와 단위에도 좌우됩니다.',
  }
}

/** Condition numbers use the original coefficient matrix A, not the row-
 * equilibrated matrix used by the solver. A single global scalar keeps the
 * condition number unchanged while protecting very small and large inputs. */
export function conditionNumber(
  matrix: number[][],
  norm: ConditionNorm = 'infinity',
): number {
  if (norm !== 'infinity' && norm !== '2')
    throw new Error('지원하지 않는 조건수 norm입니다.')
  const n = matrix.length
  if (
    !n ||
    matrix.some(
      (row) => row.length !== n || row.some((value) => !Number.isFinite(value)),
    )
  ) {
    throw new Error('조건수에는 유한한 계수의 정방행렬이 필요합니다.')
  }
  const magnitude = Math.max(...matrix.flat().map(Math.abs))
  if (magnitude === 0) return Infinity
  const normalized = matrix.map((row) => row.map((value) => value / magnitude))
  if (norm === '2') {
    // Decompose A directly: forming AᵀA would square its condition number and
    // can erase the smallest singular value in a sensitive system.
    const svd = new SingularValueDecomposition(new Matrix(normalized), {
      computeLeftSingularVectors: false,
      computeRightSingularVectors: false,
      autoTranspose: true,
    })
    const singularValues = svd.diagonal
    if (
      singularValues.length !== n ||
      singularValues.some((value) => !Number.isFinite(value) || value < 0)
    ) {
      throw new Error('SVD에서 유효한 특이값을 얻지 못했습니다.')
    }
    const largest = Math.max(...singularValues),
      smallest = Math.min(...singularValues)
    if (smallest === 0) return Infinity
    const value = largest / smallest
    return Number.isFinite(value) ? Math.max(1, value) : Infinity
  }
  const matrixNorm = Math.max(
    ...normalized.map((row) =>
      row.reduce((sum, value) => sum + Math.abs(value), 0),
    ),
  )
  const a = normalized.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ])
  for (let k = 0; k < n; k++) {
    let pivot = k
    for (let row = k + 1; row < n; row++)
      if (Math.abs(a[row][k]) > Math.abs(a[pivot][k])) pivot = row
    if (a[pivot][k] === 0) return Infinity
    ;[a[k], a[pivot]] = [a[pivot], a[k]]
    const denominator = a[k][k]
    for (let col = 0; col < 2 * n; col++) a[k][col] /= denominator
    for (let row = 0; row < n; row++)
      if (row !== k) {
        const factor = a[row][k]
        for (let col = 0; col < 2 * n; col++) a[row][col] -= factor * a[k][col]
      }
  }
  const value =
    matrixNorm *
    Math.max(
      ...a.map((row) => row.slice(n).reduce((sum, v) => sum + Math.abs(v), 0)),
    )
  return Number.isFinite(value) ? Math.max(1, value) : Infinity
}
