import type { PoolClient } from "pg";

import { oneOrNull } from "../../db";
import {
  compositeAffinity,
  directAffinity,
  indicatorBias,
  mean,
  median,
  spread,
  type AffinityDimension,
} from "../analysis";

/**
 * Personal rankings + affinity — the derived Wrapped blocks that are not
 * `challenge_metrics` (V1 §9 "Rankings pessoais", §10 "Afinidade", §11 items
 * 7 / 9 / 12). Computed live for the in-app result and frozen into the published
 * snapshot. `groupBy=checkpoint` / metric editing stays out of here.
 */

const DIRECT_MIN_SAMPLE = 5;
const DIMENSION_MIN_SAMPLE = 3;
/** V1 §10 — shared items 50%, genre 25%, year band 15%, duration 10%. */
const COMPOSITE_WEIGHTS = { items: 0.5, genre: 0.25, year_band: 0.15, duration: 0.1 } as const;

interface RatingFact {
  participantId: string;
  participantName: string;
  itemId: string;
  itemTitle: string;
  value: number;
  year: number | null;
  genre: string | null;
  runtime: number | null;
  recommendedBy: string | null;
}

async function ratingField(client: PoolClient, challengeId: string): Promise<{ fieldId: string; range: number } | null> {
  const row = await oneOrNull<{
    id: string; min_scaled: number | null; max_scaled: number | null; number_scale: number | null;
  }>(
    client,
    `SELECT f.id, f.min_scaled, f.max_scaled, f.number_scale
       FROM challenge_fields f JOIN entry_types t ON t.id = f.entry_type_id
      WHERE f.challenge_id = $1 AND f.archived_at IS NULL AND f.kind = 'rating'
        AND coalesce(t.purpose, 'rating') = 'rating'
      ORDER BY (f.semantic_key = 'nota') DESC, f.position
      LIMIT 1`,
    [challengeId],
  );
  if (!row || row.min_scaled === null || row.max_scaled === null) return null;
  const factor = 10 ** (row.number_scale ?? 0);
  const range = (row.max_scaled - row.min_scaled) / factor;
  return range > 0 ? { fieldId: row.id, range } : null;
}

async function ratingFacts(client: PoolClient, challengeId: string, fieldId: string): Promise<RatingFact[]> {
  const result = await client.query<{
    participant_id: string; participant_name: string | null; item_id: string; item_title: string | null;
    value: number; year: number | null; genre: string | null; runtime: number | null; recommended_by: string | null;
  }>(
    `SELECT e.participant_user_id AS participant_id,
            CASE WHEN cp.user_id IS NOT NULL THEN u.display_name ELSE 'Quem já saiu' END AS participant_name,
            e.item_id, ci.title AS item_title,
            (ev.number_scaled::float8 / (10 ^ f.number_scale)) AS value,
            cat.year, cat.main_genre AS genre, cat.runtime_minutes AS runtime,
            ci.recommended_by_user_id AS recommended_by
       FROM entry_values ev
       JOIN entries e ON e.id = ev.entry_id
       JOIN challenge_fields f ON f.id = ev.field_id
       LEFT JOIN challenge_items ci ON ci.id = e.item_id
       LEFT JOIN catalog_items cat ON cat.id = ci.catalog_item_id
       LEFT JOIN users u ON u.id = e.participant_user_id
       LEFT JOIN challenge_participants cp
         ON cp.challenge_id = e.challenge_id AND cp.user_id = e.participant_user_id AND cp.removed_at IS NULL
      WHERE e.challenge_id = $1 AND ev.field_id = $2
        AND e.deleted_at IS NULL AND ev.number_scaled IS NOT NULL AND e.item_id IS NOT NULL`,
    [challengeId, fieldId],
  );
  return result.rows.map((row) => ({
    participantId: row.participant_id,
    participantName: row.participant_name ?? "—",
    itemId: row.item_id,
    itemTitle: row.item_title ?? "—",
    value: row.value,
    year: row.year,
    genre: row.genre,
    runtime: row.runtime,
    recommendedBy: row.recommended_by,
  }));
}

export interface PersonalRanking {
  userId: string;
  name: string;
  entryCount: number;
  completionRate: number | null;
  ratingsMean: number | null;
  ratingsMedian: number | null;
  ratingsMin: number | null;
  ratingsMax: number | null;
  /** Population stdev of the ratings they gave — lower is steadier. */
  consistency: number | null;
  topItems: Array<{ title: string; value: number }>;
  bottomItems: Array<{ title: string; value: number }>;
  biggestSurprise: { title: string; delta: number } | null;
  biggestDisappointment: { title: string; delta: number } | null;
  indicationPerformance: number | null;
}

export interface AffinityPair {
  a: { userId: string; name: string };
  b: { userId: string; name: string };
  sampleSize: number;
  direct: number | null;
  composite: number | null;
  /** Per-dimension breakdown, present only when composite could be computed. */
  dimensions: Array<{ key: string; value: number; weight: number; sampleSize: number }>;
  skippedDimensions: string[];
}

export interface AffinityBlock {
  /** How many shared-rating items a pair needs before we score them at all. */
  minSample: number;
  scale: number;
  pairs: AffinityPair[];
  /** True once at least one pair had enough data per dimension for a composite. */
  compositeAvailable: boolean;
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function yearBand(year: number): string {
  return `${Math.floor(year / 5) * 5}s`;
}
function runtimeBand(minutes: number): string {
  if (minutes < 90) return "curto";
  if (minutes <= 120) return "médio";
  return "longo";
}

/** Direct + composite affinity for one pair, from the items they both rated. */
function affinityForPair(
  aFacts: Map<string, RatingFact>,
  bFacts: Map<string, RatingFact>,
  range: number,
): Omit<AffinityPair, "a" | "b"> {
  const shared = [...aFacts.keys()].filter((itemId) => bFacts.has(itemId));
  const pairs = shared.map((itemId) => [aFacts.get(itemId)!.value, bFacts.get(itemId)!.value] as const);
  const direct = directAffinity(pairs, range, { minSample: DIRECT_MIN_SAMPLE });

  // Per-dimension affinity = direct affinity restricted to the shared items in
  // that bucket, requiring its own small sample.
  const dimensionScore = (bucketOf: (fact: RatingFact) => string | null, key: keyof typeof COMPOSITE_WEIGHTS): AffinityDimension => {
    const byBucket = new Map<string, Array<readonly [number, number]>>();
    for (const itemId of shared) {
      const bucket = bucketOf(aFacts.get(itemId)!);
      if (!bucket) continue;
      const list = byBucket.get(bucket) ?? [];
      list.push([aFacts.get(itemId)!.value, bFacts.get(itemId)!.value]);
      byBucket.set(bucket, list);
    }
    // A dimension "has a sample" when at least one bucket clears the floor; score
    // it as the mean of the per-bucket affinities that do.
    const scores: number[] = [];
    let sample = 0;
    for (const list of byBucket.values()) {
      if (list.length < DIMENSION_MIN_SAMPLE) continue;
      const score = directAffinity(list, range, { minSample: DIMENSION_MIN_SAMPLE });
      if (score.value !== null) {
        scores.push(score.value);
        sample += score.sampleSize;
      }
    }
    return {
      key,
      value: scores.length ? round(mean(scores)!, 0) : null,
      sampleSize: sample,
      weight: COMPOSITE_WEIGHTS[key],
    };
  };

  const itemsDimension: AffinityDimension = {
    key: "items",
    value: direct.value,
    sampleSize: direct.sampleSize,
    weight: COMPOSITE_WEIGHTS.items,
  };
  const dimensions = [
    itemsDimension,
    dimensionScore((fact) => fact.genre, "genre"),
    dimensionScore((fact) => (fact.year ? yearBand(fact.year) : null), "year_band"),
    dimensionScore((fact) => (fact.runtime ? runtimeBand(fact.runtime) : null), "duration"),
  ];
  const composite = compositeAffinity(dimensions);

  return {
    sampleSize: direct.sampleSize,
    direct: direct.value,
    // Only surface a composite when a real second dimension contributed.
    composite: composite.used.length > 1 ? composite.value : null,
    dimensions: composite.used.length > 1 ? composite.used : [],
    skippedDimensions: composite.used.length > 1 ? composite.skipped : [],
  };
}

export async function computeRankings(
  client: PoolClient,
  challengeId: string,
): Promise<{ personal: PersonalRanking[]; affinity: AffinityBlock | null }> {
  const field = await ratingField(client, challengeId);
  if (!field) return { personal: [], affinity: null };

  const facts = await ratingFacts(client, challengeId, field.fieldId);
  const itemCount = (await oneOrNull<{ count: number }>(
    client,
    "SELECT count(*)::int AS count FROM challenge_items WHERE challenge_id = $1 AND archived_at IS NULL",
    [challengeId],
  ))?.count ?? 0;
  const globalMean = mean(facts.map((fact) => fact.value)) ?? 0;

  // Expectation pairs for surprise/disappointment.
  const expectationRows = await client.query<{ participant_id: string; item_id: string; item_title: string | null; delta: number }>(
    `SELECT re.participant_user_id AS participant_id, re.item_id, ci.title AS item_title,
            (rv.number_scaled::float8 / (10 ^ rf.number_scale))
            - (xv.number_scaled::float8 / (10 ^ xf.number_scale)) AS delta
       FROM entries re
       JOIN entry_types rt ON rt.id = re.entry_type_id AND coalesce(rt.purpose,'rating') = 'rating'
       JOIN entry_values rv ON rv.entry_id = re.id AND rv.field_id = $2
       JOIN challenge_fields rf ON rf.id = rv.field_id
       JOIN entries xe ON xe.challenge_id = re.challenge_id AND xe.item_id = re.item_id
        AND xe.participant_user_id = re.participant_user_id AND xe.deleted_at IS NULL
       JOIN entry_types xt ON xt.id = xe.entry_type_id AND xt.purpose = 'expectation'
       JOIN entry_values xv ON xv.entry_id = xe.id
       JOIN challenge_fields xf ON xf.id = xv.field_id AND xf.kind = 'rating'
       LEFT JOIN challenge_items ci ON ci.id = re.item_id
      WHERE re.challenge_id = $1 AND re.deleted_at IS NULL AND re.item_id IS NOT NULL
        AND rv.number_scaled IS NOT NULL AND xv.number_scaled IS NOT NULL`,
    [challengeId, field.fieldId],
  );

  const byParticipant = new Map<string, RatingFact[]>();
  for (const fact of facts) {
    const list = byParticipant.get(fact.participantId) ?? [];
    list.push(fact);
    byParticipant.set(fact.participantId, list);
  }

  const personal: PersonalRanking[] = [];
  for (const [userId, personFacts] of byParticipant) {
    const values = personFacts.map((fact) => fact.value);
    const sorted = [...personFacts].sort((a, b) => b.value - a.value);
    const myExpectations = expectationRows.rows.filter((row) => row.participant_id === userId);
    const surprise = [...myExpectations].sort((a, b) => b.delta - a.delta)[0];
    const disappointment = [...myExpectations].sort((a, b) => a.delta - b.delta)[0];
    const myPicks = facts.filter((fact) => fact.recommendedBy === userId).map((fact) => fact.value);

    personal.push({
      userId,
      name: personFacts[0].participantName,
      entryCount: personFacts.length,
      completionRate: itemCount > 0 ? round((personFacts.length / itemCount) * 100, 0) : null,
      ratingsMean: values.length ? round(mean(values)!) : null,
      ratingsMedian: median(values).value,
      ratingsMin: values.length ? Math.min(...values) : null,
      ratingsMax: values.length ? Math.max(...values) : null,
      consistency: spread(values, { minSample: 2 }).value,
      topItems: sorted.slice(0, 3).map((fact) => ({ title: fact.itemTitle, value: fact.value })),
      bottomItems: sorted.slice(-3).reverse().map((fact) => ({ title: fact.itemTitle, value: fact.value })),
      biggestSurprise: surprise && surprise.delta > 0 ? { title: surprise.item_title ?? "—", delta: round(surprise.delta) } : null,
      biggestDisappointment: disappointment && disappointment.delta < 0 ? { title: disappointment.item_title ?? "—", delta: round(disappointment.delta) } : null,
      indicationPerformance: myPicks.length ? indicatorBias(myPicks, globalMean).value : null,
    });
  }
  personal.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  // Affinity — every participant pair with enough shared ratings.
  const factsByPerson = new Map<string, Map<string, RatingFact>>();
  for (const [userId, personFacts] of byParticipant) {
    factsByPerson.set(userId, new Map(personFacts.map((fact) => [fact.itemId, fact])));
  }
  const ids = [...factsByPerson.keys()];
  const nameById = new Map(personal.map((row) => [row.userId, row.name]));
  const pairs: AffinityPair[] = [];
  let compositeAvailable = false;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const aId = ids[i];
      const bId = ids[j];
      const computed = affinityForPair(factsByPerson.get(aId)!, factsByPerson.get(bId)!, field.range);
      if (computed.sampleSize < DIRECT_MIN_SAMPLE) continue;
      if (computed.composite !== null) compositeAvailable = true;
      pairs.push({
        a: { userId: aId, name: nameById.get(aId) ?? "—" },
        b: { userId: bId, name: nameById.get(bId) ?? "—" },
        ...computed,
      });
    }
  }
  pairs.sort((x, y) => (y.direct ?? -1) - (x.direct ?? -1));

  return {
    personal,
    affinity: ids.length >= 2
      ? { minSample: DIRECT_MIN_SAMPLE, scale: field.range, pairs, compositeAvailable }
      : null,
  };
}
