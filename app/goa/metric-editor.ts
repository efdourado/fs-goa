import type { ChallengeDetail, ChallengeField, Metric, MetricGroupBy } from "./types";
import { recipeCatalogKind } from "./utils";

export const metricOperations: Metric["operation"][] = [
  "sum", "average", "median", "count", "min", "max", "completion_rate",
  "bayesian_average", "spread", "consensus", "surprise", "indicator_bias",
];
export function metricNeedsField(operation: Metric["operation"]) {
  return operation !== "count" && operation !== "completion_rate";
}

// The primary form is only a convenience view. Reading ratings, for example,
// belong to the completion form, not the primary pages-read form.
export function metricFields(challenge: Pick<ChallengeDetail, "fields" | "entryTypes">): Array<ChallengeField & { source: string }> {
  const fields = new Map<string, ChallengeField & { source: string }>();
  for (const type of challenge.entryTypes ?? []) {
    for (const field of type.fields) {
      if (field.id && (field.type === "number" || field.type === "rating")) fields.set(field.id, { ...field, source: type.name });
    }
  }
  for (const field of challenge.fields) {
    if (field.id && !fields.has(field.id) && (field.type === "number" || field.type === "rating")) fields.set(field.id, { ...field, source: "" });
  }
  return [...fields.values()];
}

export function metricGroupings(challenge: Pick<ChallengeDetail, "recipeKey" | "checkpoints" | "scope">, operation: Metric["operation"]): MetricGroupBy[] {
  const kind = recipeCatalogKind(challenge.recipeKey);
  const base: MetricGroupBy[] = ["none"];
  if (challenge.scope !== "personal") base.push("participant");
  if (kind) base.push("item");
  if (challenge.checkpoints.length) base.push("checkpoint");
  if (kind) base.push("catalog_year", "catalog_genre");
  if (kind === "book") base.push("catalog_author");
  const allowed: Partial<Record<Metric["operation"], MetricGroupBy[]>> = {
    count: ["none", "participant", "item", "checkpoint"],
    completion_rate: ["none"],
    spread: ["none", "item", "checkpoint", "catalog_year", "catalog_genre", "catalog_author"],
    consensus: ["none", "item", "checkpoint", "catalog_year", "catalog_genre", "catalog_author"],
    surprise: ["none", "item"],
    indicator_bias: ["none", "participant"],
  };
  return base.filter((group) => !allowed[operation] || allowed[operation]!.includes(group));
}

export function metricMinimum(metric: Pick<Metric, "operation" | "minSample">): number {
  return Math.max(1, metric.minSample ?? 1);
}
