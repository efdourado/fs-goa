/**
 * The Goa score: how Goa orders titles, without ever touching what anyone typed. A rating keeps its stars;
 * this is the number rankings, podiums and averages are calculated with.
 *
 * Everything runs on a 0–1 scale (a /5 and a /10 rating normalise to the same place) and inside one
 * context — one group's library, or one person's library — so nothing leaks between groups.
 *
 *   αᵢ        = nᵢ / (nᵢ + 8)                         nᵢ: distinct titles this person rated here, this one excluded
 *   relativeᵢ = clamp(0.5 + rating − usualᵢ, 0, 1)    usualᵢ: their average here, this title excluded
 *   adjustedᵢ = (1 − 0.15αᵢ) × rating + 0.15αᵢ × relativeᵢ
 *   liftᵢ(a)  = (their average with value a − usualᵢ) × k/(k + 3)     k: their titles with that value
 *   tasteᵢ    = usualᵢ + Σ(w × liftᵢ) / Σ(all w)       w: genre .4 · director/author .3 · era .15 · length .15
 *   wᵢ        = 0.8 for the title's nominator, otherwise 1 (always 1 with a single rater)
 *   strength  = 0.4 × Σ(wᵢ αᵢ) / Σwᵢ
 *   taste̅     = Σ(wᵢ αᵢ tasteᵢ) / Σ(wᵢ αᵢ)            no history anywhere → no prior
 *   score     = (Σ wᵢ adjustedᵢ + strength × taste̅) / (Σwᵢ + strength)
 *
 * Nobody has history → the (nominator-weighted) average. No ratings → no score (never zero).
 */

/** What a title is, in the terms taste can be learned from. A missing value teaches nothing (lift 0). */
export interface TitleTraits {
  genre?: string | null;
  director?: string | null;
  era?: string | null;
  length?: string | null;
}

/** One rating already on 0–1. `titleKey` identifies the title across challenges (the catalogue item). */
export interface NormalisedRating {
  personId: string;
  titleKey: string;
  value: number;
}

export interface TargetRating extends NormalisedRating {
  /** This person suggested the title. */
  nominated?: boolean;
}

const TRAIT_WEIGHTS: Record<keyof TitleTraits, number> = { genre: 0.4, director: 0.3, era: 0.15, length: 0.15 };
const TOTAL_TRAIT_WEIGHT = Object.values(TRAIT_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
const NOMINATOR_WEIGHT = 0.8;
const PRIOR_STRENGTH = 0.4;
const SCALE_SHARE = 0.15;
const EVIDENCE_HALF = 8;
const LIFT_HALF = 3;

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** A rating on any scale, on 0–1. */
export function normalise(value: number, min: number, max: number): number {
  return max > min ? clamp01((value - min) / (max - min)) : 0;
}

/** The decade a year belongs to ("1990s"), the length band a runtime or page count falls in. */
export function eraOf(year: number | null | undefined): string | null {
  return typeof year === "number" && Number.isFinite(year) ? `${Math.floor(year / 10) * 10}s` : null;
}
export function lengthOf(runtimeMinutes: number | null | undefined, pages: number | null | undefined): string | null {
  if (typeof runtimeMinutes === "number" && runtimeMinutes > 0) return runtimeMinutes < 90 ? "short" : runtimeMinutes <= 130 ? "medium" : "long";
  if (typeof pages === "number" && pages > 0) return pages < 200 ? "short" : pages <= 400 ? "medium" : "long";
  return null;
}

/**
 * A person's history in the context, as one value per distinct title (several entries on one title average to
 * one), with the scored title left out.
 */
function personHistory(history: NormalisedRating[], personId: string, excludeTitle: string): Map<string, number> {
  const byTitle = new Map<string, number[]>();
  for (const row of history) {
    if (row.personId !== personId || row.titleKey === excludeTitle) continue;
    byTitle.set(row.titleKey, [...(byTitle.get(row.titleKey) ?? []), row.value]);
  }
  return new Map([...byTitle.entries()].map(([title, values]) => [title, mean(values)]));
}

/** One rater's part in the score: their adjusted rating, their evidence (α) and their taste estimate. */
export interface RaterPart {
  rating: number;
  weight: number;
  alpha: number;
  usual: number | null;
  taste: number | null;
}

export function raterPart(
  rating: number,
  weight: number,
  history: Map<string, number>,
  traitsOf: (titleKey: string) => TitleTraits,
  target: TitleTraits,
): RaterPart {
  const n = history.size;
  if (!n) return { rating, weight, alpha: 0, usual: null, taste: null };
  const values = [...history.values()];
  const usual = mean(values);
  const alpha = n / (n + EVIDENCE_HALF);
  let weightedLift = 0;
  for (const trait of Object.keys(TRAIT_WEIGHTS) as Array<keyof TitleTraits>) {
    const value = target[trait];
    if (!value) continue;
    const same = [...history.entries()].filter(([title]) => traitsOf(title)[trait] === value).map(([, rated]) => rated);
    if (!same.length) continue;
    weightedLift += TRAIT_WEIGHTS[trait] * (mean(same) - usual) * (same.length / (same.length + LIFT_HALF));
  }
  return { rating, weight, alpha, usual, taste: usual + weightedLift / TOTAL_TRAIT_WEIGHT };
}

/** The Goa score from each rater's part — the last step, on 0–1. */
export function combineParts(parts: RaterPart[]): number | null {
  if (!parts.length) return null;
  const weights = parts.reduce((sum, part) => sum + part.weight, 0);
  const adjusted = parts.reduce((sum, part) => {
    const relative = part.usual === null ? part.rating : clamp01(0.5 + part.rating - part.usual);
    const value = (1 - SCALE_SHARE * part.alpha) * part.rating + SCALE_SHARE * part.alpha * relative;
    return sum + part.weight * value;
  }, 0);
  const evidence = parts.reduce((sum, part) => sum + part.weight * part.alpha, 0);
  if (evidence <= 0) return adjusted / weights;
  const strength = PRIOR_STRENGTH * evidence / weights;
  const taste = parts.reduce((sum, part) => sum + part.weight * part.alpha * (part.taste ?? part.rating), 0) / evidence;
  return clamp01((adjusted + strength * taste) / (weights + strength));
}

/**
 * The score of one title, on 0–1, from its ratings here (`target`) and everything else rated in the context
 * (`history`, which may include this title's own rows — they're excluded per person).
 */
export function scoreTitle(
  target: TargetRating[],
  history: NormalisedRating[],
  traitsOf: (titleKey: string) => TitleTraits,
): number | null {
  const historyOf = (personId: string) => personHistory(history, personId, "");
  return scoreWithHistories(target, historyOf, traitsOf);
}

/** A person's titles in a context, one value each (several entries on one title averaged). */
export function historiesByPerson(history: NormalisedRating[]): Map<string, Map<string, number>> {
  const people = new Map<string, NormalisedRating[]>();
  for (const row of history) people.set(row.personId, [...(people.get(row.personId) ?? []), row]);
  return new Map([...people.entries()].map(([personId, rows]) => [personId, personHistory(rows, personId, "")]));
}

/**
 * `scoreTitle` with each person's history already gathered (`historyOf` may include the scored title — it's left
 * out here). Several ratings by one person on the title count as their average.
 */
export function scoreWithHistories(
  target: TargetRating[],
  historyOf: (personId: string) => Map<string, number> | undefined,
  traitsOf: (titleKey: string) => TitleTraits,
): number | null {
  if (!target.length) return null;
  const byPerson = new Map<string, { values: number[]; nominated: boolean; titleKey: string }>();
  for (const row of target) {
    const person = byPerson.get(row.personId) ?? { values: [], nominated: false, titleKey: row.titleKey };
    person.values.push(row.value);
    person.nominated ||= row.nominated === true;
    byPerson.set(row.personId, person);
  }
  const solo = byPerson.size === 1;
  const raters = [...byPerson.entries()].map(([personId, person]) => ({
    personId, value: mean(person.values), weight: person.nominated && !solo ? NOMINATOR_WEIGHT : 1, titleKey: person.titleKey,
  }));
  const traits = traitsOf(target[0].titleKey);
  return combineParts(raters.map((rater) => {
    const full = historyOf(rater.personId) ?? new Map<string, number>();
    const past = full.has(rater.titleKey) ? new Map([...full].filter(([title]) => title !== rater.titleKey)) : full;
    return raterPart(rater.value, rater.weight, past, traitsOf, traits);
  }));
}
