/**
 * Deterministic math over already-authorized rating data. Like `lib/metrics.ts`
 * `calculateMetric`, every function has explicit empty-set semantics, never
 * mutates its input, and rejects non-finite numbers. A `minSample` floor turns a
 * thin sample into `value: null` while still reporting how thin it was.
 */

export interface AnalysisResult {
  value: number | null;
  sampleSize: number;
}

function assertFinite(values: readonly number[]): void {
  if (values.some((value) => !Number.isFinite(value))) {
    throw new TypeError("A análise aceita somente números finitos.");
  }
}

function round(value: number, decimalPlaces: number): number {
  const factor = 10 ** Math.min(6, Math.max(0, decimalPlaces));
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function belowFloor(sampleSize: number, minSample: number): boolean {
  return sampleSize < Math.max(1, minSample);
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Shrinks a small sample's average toward a prior (the global mean), weighted by
 * `priorWeight` "virtual" votes. The reference spreadsheet uses weight 4.
 */
export function bayesianAverage(
  values: readonly number[],
  priorMean: number,
  priorWeight: number,
  options: { decimalPlaces?: number; minSample?: number } = {},
): AnalysisResult {
  assertFinite(values);
  assertFinite([priorMean, priorWeight]);
  const weight = Math.max(0, priorWeight);
  if (belowFloor(values.length, options.minSample ?? 1)) {
    return { value: null, sampleSize: values.length };
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  const adjusted = (weight * priorMean + total) / (weight + values.length);
  return { value: round(adjusted, options.decimalPlaces ?? 2), sampleSize: values.length };
}

/** Population standard deviation — how much the group disagreed on an item. */
export function spread(
  values: readonly number[],
  options: { decimalPlaces?: number; minSample?: number } = {},
): AnalysisResult {
  assertFinite(values);
  if (belowFloor(values.length, options.minSample ?? 2)) {
    return { value: null, sampleSize: values.length };
  }
  const avg = mean(values)!;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return { value: round(Math.sqrt(variance), options.decimalPlaces ?? 2), sampleSize: values.length };
}

/**
 * 0 = total disagreement, 1 = unanimity. `range` is the rating scale span
 * (e.g. 5 for a 0–5 field); consensus is `1 − stdev / (range / 2)` clamped.
 */
export function consensus(
  values: readonly number[],
  range: number,
  options: { decimalPlaces?: number; minSample?: number } = {},
): AnalysisResult {
  const deviation = spread(values, { decimalPlaces: 6, minSample: options.minSample ?? 2 });
  if (deviation.value === null || range <= 0) {
    return { value: null, sampleSize: values.length };
  }
  const score = Math.max(0, Math.min(1, 1 - deviation.value / (range / 2)));
  return { value: round(score, options.decimalPlaces ?? 2), sampleSize: values.length };
}

/**
 * Mean of `a − b` over paired observations — a positive value means the ratings
 * beat expectations (surprise), a negative one means they fell short.
 */
export function meanDelta(
  pairs: ReadonlyArray<readonly [number, number]>,
  options: { decimalPlaces?: number; minSample?: number } = {},
): AnalysisResult {
  const deltas = pairs.map(([a, b]) => a - b);
  assertFinite(deltas);
  if (belowFloor(deltas.length, options.minSample ?? 1)) {
    return { value: null, sampleSize: deltas.length };
  }
  return { value: round(mean(deltas)!, options.decimalPlaces ?? 2), sampleSize: deltas.length };
}

/**
 * How a curator's picks scored relative to the group: `mean(their picks) −
 * groupMean`. `sampleSize` is how many of their picks were rated.
 */
export function indicatorBias(
  pickRatings: readonly number[],
  groupMean: number,
  options: { decimalPlaces?: number; minSample?: number } = {},
): AnalysisResult {
  assertFinite(pickRatings);
  assertFinite([groupMean]);
  if (belowFloor(pickRatings.length, options.minSample ?? 1)) {
    return { value: null, sampleSize: pickRatings.length };
  }
  return {
    value: round(mean(pickRatings)! - groupMean, options.decimalPlaces ?? 2),
    sampleSize: pickRatings.length,
  };
}
