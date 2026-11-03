import type { ChallengeDetail, ChallengeField, Metric, MetricGroupBy } from "./types";
import { recipeCatalogKind } from "./utils";

export const metricOperations: Metric["operation"][] = [
  "sum", "average", "median", "count", "min", "max", "completion_rate",
  "bayesian_average", "spread", "consensus", "surprise",
];
export function metricNeedsField(operation: Metric["operation"]) {
  return operation !== "count" && operation !== "completion_rate";
}

// The primary form is only a convenience view. Reading ratings, for example,
// belong to the completion form, not the primary pages-read form.
export function metricFields(challenge: Pick<ChallengeDetail, "fields" | "entryTypes">): Array<ChallengeField & { source: string; entryTypeId?: string }> {
  const fields = new Map<string, ChallengeField & { source: string; entryTypeId?: string }>();
  for (const type of challenge.entryTypes ?? []) {
    for (const field of type.fields) {
      if (field.id && (field.type === "number" || field.type === "rating")) fields.set(field.id, { ...field, entryTypeId: type.id, source: type.name });
    }
  }
  for (const field of challenge.fields) {
    if (field.id && !fields.has(field.id) && (field.type === "number" || field.type === "rating")) fields.set(field.id, { ...field, source: "" });
  }
  return [...fields.values()];
}

export function metricGroupings(challenge: Pick<ChallengeDetail, "recipeKey" | "checkpoints" | "scope" | "submissionMode">, operation: Metric["operation"]): MetricGroupBy[] {
  const kind = recipeCatalogKind(challenge.recipeKey);
  const base: MetricGroupBy[] = ["none"];
  if (challenge.scope !== "personal") base.push("participant");
  // Any challenge built on items can rank them — Tables and custom ones too, not only films and books.
  if (kind || challenge.submissionMode === "item") base.push("item");
  if (challenge.checkpoints.length) base.push("checkpoint");
  if (kind) base.push("catalog_year", "catalog_genre");
  if (kind === "book") base.push("catalog_author");
  const allowed: Partial<Record<Metric["operation"], MetricGroupBy[]>> = {
    count: ["none", "participant", "item", "checkpoint"],
    completion_rate: ["none"],
    spread: ["none", "item", "checkpoint", "catalog_year", "catalog_genre", "catalog_author"],
    consensus: ["none", "item", "checkpoint", "catalog_year", "catalog_genre", "catalog_author"],
    surprise: ["none", "item"],
  };
  return base.filter((group) => !allowed[operation] || allowed[operation]!.includes(group));
}

/** How a ranking of items scores each one: a plain average, or one that steadies items with only a few ratings. */
export const rankingScores: Metric["operation"][] = ["average", "bayesian_average"];

/** Whether the challenge has items to rank and something numeric to rank them by. */
export function canRankItems(challenge: Pick<ChallengeDetail, "recipeKey" | "checkpoints" | "scope" | "submissionMode" | "fields" | "entryTypes">): boolean {
  return metricFields(challenge).length > 0 && metricGroupings(challenge, "average").includes("item");
}

/** "Average of my ratings" is what a ranking almost always means, so the rating fields start ticked. */
export function defaultRankingFieldIds(fields: Array<Pick<ChallengeField, "id" | "type">>): string[] {
  return fields.filter((field) => field.type === "rating" && field.id).map((field) => field.id!);
}

export function metricMinimum(metric: Pick<Metric, "operation" | "minSample">): number {
  return Math.max(1, metric.minSample ?? 1);
}

/** Full update shape: changing visibility must preserve the calculation and its scope. */
export function metricUpdatePayload(metric: Metric): Record<string, unknown> {
  return {
    label: metric.label, operation: metric.operation, entryTypeId: metric.entryTypeId,
    fieldId: metric.fieldId, fieldIds: metric.fieldIds, combineOp: metric.combineOp ?? "average",
    groupBy: metric.groupBy ?? "none", minSample: metric.minSample ?? 1,
    bayesPriorWeight: metric.bayesPriorWeight ?? 4, cumulative: metric.cumulative ?? false,
    visibleDuring: metric.visibleDuring !== false, visibleInResults: metric.visibleInResults !== false,
    isRating: metric.isRating ?? false, countDays: metric.countDays ?? false, itemId: metric.itemId ?? null,
  };
}
