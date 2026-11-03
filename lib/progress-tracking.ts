import { parseResultPresentation, type ResultPresentation } from "./result-presentation";

/** Shared contract for the saved rules and the results that explain them. */
export interface ProgressTracking {
  results?: ResultPresentation;
  performance?: {
    mode: "product" | "separate";
    fieldIds: string[];
    sessionAggregation?: "best" | "sum";
  };
  consistency?: {
    target: number;
    periodDays: number;
    count: "sessions" | "days";
  } | null;
}

export function parseProgressTracking(raw: unknown): ProgressTracking {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid progress tracking settings");
  const value = raw as Record<string, unknown>;
  const result: ProgressTracking = {};
  if (value.results !== undefined) result.results = parseResultPresentation(value.results);
  if (value.performance !== undefined) {
    const p = value.performance as Record<string, unknown> | null;
    if (!p || !["product", "separate"].includes(String(p.mode)) || !Array.isArray(p.fieldIds)
      || p.fieldIds.length > 20 || p.fieldIds.some((id) => typeof id !== "string")
      || new Set(p.fieldIds).size !== p.fieldIds.length
      || (p.mode === "product" && p.fieldIds.length < 2)) throw new Error("Choose at least two numeric properties for workload");
    if (p.sessionAggregation !== undefined && !["best", "sum"].includes(String(p.sessionAggregation))) throw new Error("Choose how to combine session records");
    result.performance = { sessionAggregation: p.sessionAggregation === "sum" ? "sum" : "best", mode: p.mode as "product" | "separate", fieldIds: p.fieldIds as string[] };
  }
  if (value.consistency != null) {
    const c = value.consistency as Record<string, unknown>;
    if (!Number.isInteger(c.target) || Number(c.target) < 1 || Number(c.target) > 1000
      || !Number.isInteger(c.periodDays) || Number(c.periodDays) < 1 || Number(c.periodDays) > 366
      || !["sessions", "days"].includes(String(c.count))
      || (c.count === "days" && Number(c.target) > Number(c.periodDays))) throw new Error("Choose a valid consistency goal");
    result.consistency = { target: Number(c.target), periodDays: Number(c.periodDays), count: c.count as "sessions" | "days" };
  } else result.consistency = null;
  return result;
}

export interface TrackingField { id?: string; key: string; label: string; type: string; config?: { unit?: string | null } }
/** Workload is explicit. Numeric fields alone cannot tell us whether reps are per set or a session total. */
export function performancePlans(fields: TrackingField[], settings?: ProgressTracking["performance"]) {
  const numeric = fields.filter((f) => f.id && f.type === "number");
  const selected = settings?.fieldIds.length ? numeric.filter((f) => settings.fieldIds.includes(f.id!)) : numeric;
  if (settings?.mode === "product") return selected.length === settings.fieldIds.length && selected.length >= 2 ? [{ fields: selected, product: true }] : [];
  return selected.map((f) => ({ fields: [f], product: false }));
}

const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);
/** Full periods contribute capped attainment. The open period has its own counter, never an early failure. */
export function consistencyProgress(days: string[], from: string, to: string, goal: NonNullable<ProgressTracking["consistency"]>, closed: boolean) {
  const start = dayNumber(from);
  const end = dayNumber(to);
  const currentIndex = Math.floor((end - start) / goal.periodDays);
  const counts = new Map<number, number>();
  for (const day of goal.count === "days" ? [...new Set(days)] : days) {
    const index = Math.floor((dayNumber(day) - start) / goal.periodDays);
    if (index >= 0 && dayNumber(day) <= end) counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  // An end date includes its final day. A partial final period is settled when the challenge ends.
  const completed = closed ? currentIndex + 1 : currentIndex;
  let attained = 0;
  for (let i = 0; i < completed; i++) attained += Math.min(goal.target, counts.get(i) ?? 0);
  return { value: completed ? Math.round(100 * attained / (completed * goal.target)) : null,
    current: closed ? null : counts.get(currentIndex) ?? 0, target: goal.target, periodDays: goal.periodDays, completed };
}
