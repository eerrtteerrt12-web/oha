export type ChartDomain = [number, number, number[]]

// Weighted interpolation and normalized coordinates avoid overflowing the span
// when finite endpoints have opposite signs near Number.MAX_VALUE.
export function interpolate(min: number, max: number, ratio: number): number {
  if (ratio === 0) return min
  if (ratio === 1) return max
  const span = max - min
  if (Number.isFinite(span)) return min + span * ratio
  return min * (1 - ratio) + max * ratio
}

export function fraction(value: number, min: number, max: number): number {
  const scale = Math.max(Math.abs(min), Math.abs(max))
  if (!scale || min === max) return 0.5
  return (value / scale - min / scale) / (max / scale - min / scale)
}

/** Fit visible values, preserving variation even for roots far from zero. */
export function fittedDomain(values: readonly number[]): ChartDomain {
  let min = Infinity
  let max = -Infinity
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  if (min === Infinity) return [0, 1, [0, 0.25, 0.5, 0.75, 1]]

  // Compute the padding before subtracting large endpoints. A single constant
  // also needs a local range, rather than an axis anchored at zero.
  const padding =
    min === max
      ? min === 0
        ? 1
        : Math.max(Math.abs(min) * 0.05, Number.MIN_VALUE)
      : Math.max(max * 0.08 - min * 0.08, Number.MIN_VALUE)
  const paddedMin = min - padding
  const paddedMax = max + padding
  if (Number.isFinite(paddedMin)) min = paddedMin
  if (Number.isFinite(paddedMax)) max = paddedMax

  const fallback = (): ChartDomain => [
    min,
    max,
    [
      ...new Set(
        Array.from({ length: 5 }, (_, i) => interpolate(min, max, i / 4)),
      ),
    ],
  ]
  const rawStep = max / 4 - min / 4
  if (!Number.isFinite(rawStep) || rawStep <= 0) return fallback()
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  if (!Number.isFinite(magnitude) || magnitude === 0) return fallback()
  const factor = rawStep / magnitude
  const step =
    (factor <= 1
      ? 1
      : factor <= 2
        ? 2
        : factor <= 2.5
          ? 2.5
          : factor <= 5
            ? 5
            : 10) * magnitude
  if (!Number.isFinite(step) || step <= 0) return fallback()
  const roundedMin = Math.floor(min / step) * step
  const roundedMax = Math.ceil(max / step) * step
  if (Number.isFinite(roundedMin) && roundedMin <= min) min = roundedMin
  if (Number.isFinite(roundedMax) && roundedMax >= max) max = roundedMax
  const count = Math.round(max / step - min / step)
  if (!Number.isFinite(count) || count < 1 || count > 20) return fallback()
  return [
    min,
    max,
    [
      ...new Set(
        Array.from({ length: count + 1 }, (_, i) =>
          interpolate(min, max, i / count),
        ),
      ),
    ],
  ]
}
