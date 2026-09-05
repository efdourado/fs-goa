import type { PoolClient } from "pg";

import type { SessionContext } from "../../auth";
import { inTransaction, oneOrNull } from "../../db";
// Direct module imports, not the `goa-domain` barrel: that barrel also re-exports
// `createChallenge`, which imports this file — going through it would form a cycle.
import { challengeAccess } from "../domain/access";
import { writeAudit } from "../domain/audit";
import { publicId } from "../domain/shared";
import { insertField } from "../domain/fields";
import { ApiError } from "../../http";

export type SubmissionMode = "item" | "daily" | "free";
export type Purpose = "progress" | "completion" | "expectation" | "rating" | "checkin";
export type TargetPolicy = "required" | "optional" | "none";
export type Cardinality =
  | "once_per_item"
  | "once_per_item_day"
  | "repeatable"
  | "once_per_day";
export type SchedulePolicy = "free" | "while_active" | "checkpoint";
export type VisibilityPolicy = "group_realtime" | "after_own" | "after_close" | "author_only";

export const VISIBILITY_POLICIES: readonly VisibilityPolicy[] = [
  "group_realtime", "after_own", "after_close", "author_only",
];

export function isVisibilityPolicy(value: unknown): value is VisibilityPolicy {
  return typeof value === "string" && (VISIBILITY_POLICIES as readonly string[]).includes(value);
}

export interface EntryTypeRow {
  id: string;
  challenge_id: string;
  semantic_key: string;
  name: string;
  submission_mode: SubmissionMode;
  purpose: Purpose | null;
  target_policy: TargetPolicy | null;
  cardinality: Cardinality | null;
  schedule_policy: SchedulePolicy | null;
  is_primary: boolean;
  visibility_policy: VisibilityPolicy;
}

const SELECT_COLUMNS = `id, challenge_id, semantic_key, name, submission_mode,
  purpose, target_policy, cardinality, schedule_policy, is_primary, visibility_policy`;

/**
 * The four orthogonal axes are nullable until every legacy row is backfilled, so
 * every reader goes through these fallbacks. They mirror migration 0012's
 * backfill: `submission_mode` is the source of truth when an axis is still null.
 */
export function targetPolicyOf(type: Pick<EntryTypeRow, "submission_mode" | "target_policy">): TargetPolicy {
  if (type.target_policy) return type.target_policy;
  return type.submission_mode === "item" ? "required" : "none";
}

export function cardinalityOf(type: Pick<EntryTypeRow, "submission_mode" | "cardinality">): Cardinality {
  if (type.cardinality) return type.cardinality;
  if (type.submission_mode === "item") return "once_per_item";
  if (type.submission_mode === "daily") return "once_per_day";
  return "repeatable";
}

export function schedulePolicyOf(
  type: Pick<EntryTypeRow, "submission_mode" | "schedule_policy">,
  challengeHasPeriod: boolean,
): SchedulePolicy {
  if (type.schedule_policy) return type.schedule_policy;
  if (type.submission_mode === "item") return "while_active";
  if (type.submission_mode === "daily") return challengeHasPeriod ? "checkpoint" : "free";
  return "free";
}

export function purposeOf(type: Pick<EntryTypeRow, "submission_mode" | "purpose">): Purpose {
  return type.purpose ?? (type.submission_mode === "item" ? "rating" : "checkin");
}

/**
 * The type the single-type surfaces (challenge detail's flat `fields`, the
 * metrics tab, activation readiness) default to. When a challenge carries an
 * "expectativa" type alongside the real one, that extra type never wins.
 */
export async function primaryEntryType(
  client: PoolClient,
  challengeId: string,
): Promise<EntryTypeRow | null> {
  return oneOrNull<EntryTypeRow>(
    client,
    `SELECT ${SELECT_COLUMNS} FROM entry_types
      WHERE challenge_id = $1 AND archived_at IS NULL
      ORDER BY is_primary DESC, (coalesce(purpose, '') = 'expectation'), created_at
      LIMIT 1`,
    [challengeId],
  );
}

/**
 * The type whose entries mean "done" for progress counters and completion rate:
 * a dedicated `completion` type wins, otherwise the primary type is the signal
 * (a rating = "assisti e avaliei", a check-in = "fiz hoje" — an expectation or a
 * mid-round progress note never counts).
 */
export async function completionEntryType(
  client: PoolClient,
  challengeId: string,
): Promise<EntryTypeRow | null> {
  const types = await entryTypesForChallenge(client, challengeId);
  return (
    types.find((type) => type.purpose === "completion")
    ?? types.find((type) => type.is_primary)
    ?? types.find((type) => type.purpose !== "expectation")
    ?? types[0]
    ?? null
  );
}

export async function entryTypesForChallenge(
  client: PoolClient,
  challengeId: string,
): Promise<EntryTypeRow[]> {
  const result = await client.query<EntryTypeRow>(
    `SELECT ${SELECT_COLUMNS} FROM entry_types
      WHERE challenge_id = $1 AND archived_at IS NULL
      ORDER BY created_at`,
    [challengeId],
  );
  return result.rows;
}

export async function entryTypeById(
  client: PoolClient,
  challengeId: string,
  entryTypeId: string,
): Promise<EntryTypeRow | null> {
  return oneOrNull<EntryTypeRow>(
    client,
    `SELECT ${SELECT_COLUMNS} FROM entry_types
      WHERE id = $1 AND challenge_id = $2 AND archived_at IS NULL`,
    [entryTypeId, challengeId],
  );
}

/**
 * Owner/admin sets who sees other participants' answers of one entry type.
 * A safe, non-destructive change — allowed while the round is active — but
 * blocked once it is closed and frozen.
 */
export async function updateEntryTypeVisibility(
  session: SessionContext,
  challengeId: string,
  entryTypeId: string,
  body: Record<string, unknown>,
) {
  if (!isVisibilityPolicy(body.visibilityPolicy)) {
    throw new ApiError(400, "invalid_visibility", "Política de visibilidade inválida.");
  }
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores mudam a visibilidade.");
    if (access.challenge.status === "closed") {
      throw new ApiError(409, "challenge_closed", "Um desafio encerrado fica congelado.");
    }
    const type = await oneOrNull<{ visibility_policy: string; name: string }>(
      client,
      "SELECT visibility_policy, name FROM entry_types WHERE id = $1 AND challenge_id = $2 AND archived_at IS NULL FOR UPDATE",
      [entryTypeId, challengeId],
    );
    if (!type) throw new ApiError(404, "not_found", "Tipo de registro não encontrado.");
    if (type.visibility_policy !== body.visibilityPolicy) {
      await client.query(
        "UPDATE entry_types SET visibility_policy = $3, updated_at = now() WHERE id = $1 AND challenge_id = $2",
        [entryTypeId, challengeId, body.visibilityPolicy],
      );
      await writeAudit(
        client, access.challenge.group_id, challengeId, session.user.id,
        "entry_type.visibility_changed", "entry_type", entryTypeId,
        { visibilityPolicy: type.visibility_policy }, { visibilityPolicy: body.visibilityPolicy },
      );
    }
    return { id: entryTypeId, visibilityPolicy: body.visibilityPolicy };
  });
}

/** Any of the challenge's types point at a round item (film / book). */
export function usesRoundItems(types: EntryTypeRow[]): boolean {
  return types.some((type) => targetPolicyOf(type) !== "none");
}

export const EXPECTATION_SEMANTIC_KEY = "expectativa";

/**
 * The optional Cinema/Estante "Expectativa" type (V1 §3.1): a pre-watch 0–5
 * rating, one per item, that stops being editable once the participant sends
 * their real rating (`expectation_locked`). Its default visibility is
 * "after_own" so nobody's number is coloured by seeing everyone else's guess
 * before they commit their own.
 */
export async function seedExpectationType(
  client: PoolClient,
  challengeId: string,
): Promise<string> {
  const typeId = publicId();
  await client.query(
    `INSERT INTO entry_types
       (id, challenge_id, semantic_key, name, submission_mode, purpose, target_policy,
        cardinality, schedule_policy, is_primary, visibility_policy, created_at, updated_at)
     VALUES ($1,$2,$3,'Expectativa','item','expectation','required','once_per_item','while_active',false,'after_own',now(),now())`,
    [typeId, challengeId, EXPECTATION_SEMANTIC_KEY],
  );
  await insertField(
    client,
    challengeId,
    typeId,
    { key: EXPECTATION_SEMANTIC_KEY, label: "Expectativa", type: "rating", required: true, config: { min: 0, max: 5, step: 0.5 } },
    0,
  );
  return typeId;
}

/**
 * Owner/admin turns the optional expectation type on or off. Structural, so
 * draft-only; turning it off is refused once it has entries. A recipe with no
 * rating type over round items (Hábito, a reading club's progress) cannot host
 * an expectation at all.
 */
export async function setExpectationEnabled(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  if (typeof body.enabled !== "boolean") {
    throw new ApiError(400, "invalid_request", "Informe se a expectativa fica ligada ou desligada.");
  }
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores mudam os tipos de registro.");
    if (access.challenge.status !== "draft") {
      throw new ApiError(409, "challenge_locked", "A expectativa só entra ou sai enquanto o desafio é um rascunho.");
    }
    const types = await entryTypesForChallenge(client, challengeId);
    const hasRatingOverItems =
      usesRoundItems(types) && types.some((type) => purposeOf(type) === "rating");
    if (!hasRatingOverItems) {
      throw new ApiError(409, "expectation_unsupported", "A expectativa só existe num modelo de avaliação de filmes ou livros.");
    }

    const active = types.find((type) => purposeOf(type) === "expectation");
    if (body.enabled) {
      if (active) return { enabled: true, entryTypeId: active.id };
      const archived = await oneOrNull<{ id: string }>(
        client,
        "SELECT id FROM entry_types WHERE challenge_id=$1 AND purpose='expectation' AND archived_at IS NOT NULL ORDER BY created_at DESC LIMIT 1",
        [challengeId],
      );
      let entryTypeId: string;
      if (archived) {
        entryTypeId = archived.id;
        await client.query("UPDATE entry_types SET archived_at=NULL, updated_at=now() WHERE id=$1", [entryTypeId]);
        await client.query(
          "UPDATE challenge_fields SET archived_at=NULL, updated_at=now() WHERE entry_type_id=$1",
          [entryTypeId],
        );
      } else {
        entryTypeId = await seedExpectationType(client, challengeId);
      }
      await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
        "entry_type.created", "entry_type", entryTypeId, null, { purpose: "expectation" });
      return { enabled: true, entryTypeId };
    }

    if (!active) return { enabled: false, entryTypeId: null };
    const withEntries = await oneOrNull<{ count: number }>(
      client,
      "SELECT count(*)::int AS count FROM entries WHERE entry_type_id=$1 AND deleted_at IS NULL",
      [active.id],
    );
    if (withEntries && withEntries.count > 0) {
      throw new ApiError(409, "expectation_has_entries", "Já há expectativas registradas — não dá para remover o tipo.");
    }
    await client.query("UPDATE challenge_fields SET archived_at=now(), updated_at=now() WHERE entry_type_id=$1", [active.id]);
    await client.query("UPDATE entry_types SET archived_at=now(), updated_at=now() WHERE id=$1", [active.id]);
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      "entry_type.archived", "entry_type", active.id, null, { purpose: "expectation" });
    return { enabled: false, entryTypeId: null };
  });
}

/** Any type is bound to dated checkpoints — only meaningful with a fixed period. */
export function usesCheckpoints(types: EntryTypeRow[], challengeHasPeriod: boolean): boolean {
  return (
    challengeHasPeriod
    && types.some((type) => schedulePolicyOf(type, challengeHasPeriod) === "checkpoint")
  );
}

/** The catalog kind a recipe tracks; null when it has no round items. */
export function recipeCatalogKind(recipeKey: string | null): "film" | "book" | null {
  if (recipeKey === "cinema" || recipeKey === "cine_free" || recipeKey === "cine_curated") return "film";
  if (recipeKey === "library" || recipeKey === "bookshelf" || recipeKey === "reading_club" || recipeKey === "reading_daily") return "book";
  return null;
}
