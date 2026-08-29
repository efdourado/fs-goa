export type MetricOperation = "sum" | "average" | "count" | "min" | "max" | "completion_rate";

export interface MetricInput {
  operation: MetricOperation;
  values?: readonly number[];
  completed?: number;
  expected?: number;
  decimalPlaces?: number;
}

export interface MetricResult {
  value: number | null;
  sampleSize: number;
}

function round(value: number, decimalPlaces: number): number {
  const factor = 10 ** decimalPlaces;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Deterministic calculation over already-authorized data. It never mutates
 * the source array and has explicit empty-set semantics.
 */
export function calculateMetric(input: MetricInput): MetricResult {
  const decimalPlaces = Math.min(6, Math.max(0, input.decimalPlaces ?? 2));
  const values = [...(input.values ?? [])];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new TypeError("Métricas aceitam somente números finitos.");
  }

  if (input.operation === "completion_rate") {
    const completed = Math.max(0, input.completed ?? 0);
    const expected = Math.max(0, input.expected ?? 0);
    return {
      value: expected === 0 ? 0 : round((Math.min(completed, expected) / expected) * 100, decimalPlaces),
      sampleSize: completed,
    };
  }

  if (input.operation === "count") return { value: values.length, sampleSize: values.length };
  if (input.operation === "sum") {
    return { value: round(values.reduce((total, value) => total + value, 0), decimalPlaces), sampleSize: values.length };
  }
  if (values.length === 0) return { value: null, sampleSize: 0 };

  if (input.operation === "average") {
    return {
      value: round(values.reduce((total, value) => total + value, 0) / values.length, decimalPlaces),
      sampleSize: values.length,
    };
  }
  if (input.operation === "min") return { value: Math.min(...values), sampleSize: values.length };
  if (input.operation === "max") return { value: Math.max(...values), sampleSize: values.length };
  throw new TypeError("Operação de métrica não suportada.");
}

