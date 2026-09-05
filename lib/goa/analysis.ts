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
 * Middle value of the sorted sequence; with an even count, the mean of the two
 * central values (V1 §9). Empty set → null.
 */
export function median(
  values: readonly number[],
  options: { decimalPlaces?: number; minSample?: number } = {},
): AnalysisResult {
  assertFinite(values);
  if (belowFloor(values.length, options.minSample ?? 1)) {
    return { value: null, sampleSize: values.length };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const raw = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  return { value: round(raw, options.decimalPlaces ?? 2), sampleSize: values.length };
}

/**
 * Direct affinity between two people over the items they both rated (V1 §10):
 *
 *   afinidade = 100 × (1 − média(|a − b|) / amplitude)
 *
 * `pairs` is `[theirRating, myRating]` for each shared item; `range` is the scale
 * span (5 for a 0–5 field). Never computed on 1–2 items — the hard floor is 3,
 * and the recommended `minSample` is 5. Below the floor: `value: null`, sample
 * still reported.
 */
export function directAffinity(
  pairs: ReadonlyArray<readonly [number, number]>,
  range: number,
  options: { decimalPlaces?: number; minSample?: number } = {},
): AnalysisResult {
  const diffs = pairs.map(([a, b]) => Math.abs(a - b));
  assertFinite(diffs);
  assertFinite([range]);
  const floor = Math.max(3, options.minSample ?? 5);
  if (diffs.length < floor || range <= 0) {
    return { value: null, sampleSize: diffs.length };
  }
  const score = Math.max(0, Math.min(100, 100 * (1 - mean(diffs)! / range)));
  return { value: round(score, options.decimalPlaces ?? 0), sampleSize: diffs.length };
}

export interface AffinityDimension {
  /** e.g. "items" | "genre" | "year_band" | "duration". */
  key: string;
  /** 0–100 affinity on this dimension, or null when it has no usable sample. */
  value: number | null;
  sampleSize: number;
  /** Configured weight before redistribution. */
  weight: number;
}

export interface CompositeAffinityResult {
  value: number | null;
  /** Dimensions that actually contributed, with their post-redistribution weight. */
  used: Array<{ key: string; value: number; weight: number; sampleSize: number }>;
  /** Dimensions dropped for want of a sample. */
  skipped: string[];
}

/**
 * Weighted blend of per-dimension affinities (V1 §10 "afinidade composta").
 * A dimension with `value === null` (no sample) is dropped and its weight is
 * redistributed proportionally across the ones that remain. Returns `null` when
 * nothing qualifies — the caller then shows only the direct number.
 */
export function compositeAffinity(
  dimensions: readonly AffinityDimension[],
  options: { decimalPlaces?: number } = {},
): CompositeAffinityResult {
  const live = dimensions.filter(
    (dimension): dimension is AffinityDimension & { value: number } =>
      dimension.value !== null && dimension.weight > 0,
  );
  const totalWeight = live.reduce((sum, dimension) => sum + dimension.weight, 0);
  if (!live.length || totalWeight <= 0) {
    return { value: null, used: [], skipped: dimensions.map((dimension) => dimension.key) };
  }
  const used = live.map((dimension) => ({
    key: dimension.key,
    value: dimension.value,
    weight: round(dimension.weight / totalWeight, 4),
    sampleSize: dimension.sampleSize,
  }));
  const blended = used.reduce((sum, dimension) => sum + dimension.value * dimension.weight, 0);
  return {
    value: round(blended, options.decimalPlaces ?? 0),
    used,
    skipped: dimensions.filter((dimension) => dimension.value === null || dimension.weight <= 0).map((dimension) => dimension.key),
  };
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
 * Agreement on a 0–100 scale (V1 §9): `max(0, 1 − stdev / (range / 2)) × 100`.
 * `range` is the rating scale span (5 for a 0–5 field). 0 = total disagreement,
 * 100 = unanimity.
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
  const score = Math.max(0, Math.min(1, 1 - deviation.value / (range / 2))) * 100;
  return { value: round(score, options.decimalPlaces ?? 0), sampleSize: values.length };
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
