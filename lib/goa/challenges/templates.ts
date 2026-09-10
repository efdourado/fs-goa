import { requireGroupRole, type SessionContext } from "../../auth";
import { inTransaction, oneOrNull, withClient } from "../../db";
import { challengeAccess, writeAudit } from "../../goa-domain";
import { ApiError, stringValue } from "../../http";
import { assertUnder, LIMITS } from "../../limits";
import { parseRuleSections } from "../domain/rules";
import { copyChallengeStructure } from "./copy";
import { buildChallengeDetail, type DetailChallengeRow } from "./detail";
import { isRecipeKey } from "./recipes";

/**
 * Templates are ordinary challenges that a platform admin has flagged for the
 * public gallery (`published_as_template_at`). The gallery and the detail view
 * are read-only projections — never entries, participants, results, or the group
 * they live in — and anyone, signed in or not, can read them.
 */

interface TemplateRow {
  id: string;
  title: string;
  description: string | null;
  summary: string | null;
  rules: string | null;
  rule_sections: unknown;
  start_date: string | null;
  end_date: string | null;
  published_as_template_at: Date;
  submission_mode: "item" | "daily" | "free" | null;
  field_count: number;
  item_count: number;
  metric_count: number;
}

function ruleCount(row: Pick<TemplateRow, "rule_sections" | "rules">): number {
  return parseRuleSections(row.rule_sections, row.rules).length;
}

export async function listTemplates() {
  return withClient(async (client) => {
    const rows = await client.query<TemplateRow>(
      // The gallery blurb is the showcase summary — the one the challenge admin
      // curates below the headline in the Vitrine tab — falling back to the
      // plain description (in JS below) when there is no showcase yet.
      `SELECT c.id, c.title, c.description,
              (SELECT rb.body_snapshot FROM result_blocks rb
                WHERE rb.challenge_id = c.id AND rb.kind = 'text' AND rb.heading = 'summary'
                  AND rb.body_snapshot <> '' LIMIT 1) AS summary,
              c.rules, c.rule_sections, c.start_date::text AS start_date,
              c.end_date::text AS end_date, c.published_as_template_at,
              (SELECT et.submission_mode FROM entry_types et
                WHERE et.challenge_id = c.id AND et.archived_at IS NULL
                ORDER BY (et.purpose = 'expectation'), et.created_at LIMIT 1) AS submission_mode,
              (SELECT count(*)::int FROM challenge_fields f
                WHERE f.challenge_id = c.id AND f.archived_at IS NULL) AS field_count,
              (SELECT count(*)::int FROM challenge_items i
                WHERE i.challenge_id = c.id AND i.archived_at IS NULL) AS item_count,
              (SELECT count(*)::int FROM challenge_metrics m
                WHERE m.challenge_id = c.id AND m.archived_at IS NULL) AS metric_count
         FROM challenges c
         JOIN groups g ON g.id = c.group_id AND g.deleted_at IS NULL AND g.archived_at IS NULL
        WHERE c.published_as_template_at IS NOT NULL AND c.deleted_at IS NULL
          AND c.recipe_key IN ('cinema', 'library', 'bookshelf', 'habit')
        ORDER BY c.published_as_template_at DESC`,
    );
    return {
      templates: rows.rows.map((row) => ({
        id: row.id,
        title: row.title,
        summary: row.summary ?? row.description ?? null,
        submissionMode: row.submission_mode ?? "free",
        ruleCount: ruleCount(row),
        fieldCount: row.field_count,
        itemCount: row.item_count,
        metricCount: row.metric_count,
        publishedAt: row.published_as_template_at.toISOString(),
      })),
    };
  });
}

/**
 * A published template rendered as the same read-only `ChallengeDetail` the
 * in-app challenge screen consumes — spotlight header, rules, schedule, and the
 * Results tab. Public: no session. Privacy — never the origin group's members
 * (`participants: []`); the Results showcase is only the frozen
 * `results_published_snapshot` (already anonymised + admin-published), never the
 * live in-group result.
 */
export async function getTemplatePreview(challengeId: string) {
  return withClient(async (client) => {
    const row = await oneOrNull<DetailChallengeRow & {
      results_published_at: Date | null;
      results_published_snapshot: { result?: unknown } | null;
    }>(
      client,
      `SELECT c.id, c.group_id, c.title, c.description, c.rules, c.rule_sections,
              c.start_date::text AS start_date, c.end_date::text AS end_date,
              c.status, c.kind, c.recipe_key, g.kind AS group_kind, c.results_anon,
              c.show_schedule, c.published_as_template_at,
              c.results_published_at, c.results_published_snapshot
         FROM challenges c
         JOIN groups g ON g.id = c.group_id AND g.deleted_at IS NULL AND g.archived_at IS NULL
        WHERE c.id = $1 AND c.published_as_template_at IS NOT NULL AND c.deleted_at IS NULL
          AND c.recipe_key IN ('cinema', 'library', 'bookshelf', 'habit')`,
      [challengeId],
    );
    if (!row) throw new ApiError(404, "not_found", "Modelo não encontrado.");

    // Same gate as the public /results/<token> page.
    const publishedResult = row.results_published_at !== null && row.status === "closed"
      ? row.results_published_snapshot?.result ?? null
      : null;

    const detail = await buildChallengeDetail(
      client,
      row,
      { userId: null, role: null, isParticipant: false },
      { participants: [], result: publishedResult },
    );
    return detail;
  });
}

export async function setChallengeTemplate(
  session: SessionContext,
  challengeId: string,
) {
  if (!session.user.platformAdmin) {
    throw new ApiError(403, "forbidden", "Somente a administração da plataforma publica modelos.");
  }
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) {
      throw new ApiError(403, "forbidden", "Você precisa administrar este desafio.");
    }
    if (!isRecipeKey(access.challenge.recipe_key)) {
      throw new ApiError(
        409,
        "legacy_recipe_read_only",
        "Desafios antigos continuam disponíveis para consulta, mas não podem virar novos modelos.",
      );
    }
    const updated = await oneOrNull<{ published_as_template_at: Date | null }>(
      client,
      `UPDATE challenges
          SET published_as_template_at = COALESCE(published_as_template_at, now()),
              updated_at = now()
        WHERE id = $1
      RETURNING published_as_template_at`,
      [challengeId],
    );
    await writeAudit(
      client,
      access.challenge.group_id,
      challengeId,
      session.user.id,
      "challenge.template_published",
      "challenge",
      challengeId,
      null,
      null,
    );
    return {
      id: challengeId,
      publishedAsTemplate: true,
      publishedAt: updated?.published_as_template_at?.toISOString() ?? null,
    };
  });
}

export async function unpublishChallengeTemplate(session: SessionContext, challengeId: string) {
  if (!session.user.platformAdmin) {
    throw new ApiError(403, "forbidden", "Somente a administração da plataforma publica modelos.");
  }
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) {
      throw new ApiError(403, "forbidden", "Você precisa administrar este desafio.");
    }
    await client.query(
      `UPDATE challenges SET published_as_template_at = NULL, updated_at = now()
        WHERE id = $1`,
      [challengeId],
    );
    await writeAudit(
      client,
      access.challenge.group_id,
      challengeId,
      session.user.id,
      "challenge.template_unpublished",
      "challenge",
      challengeId,
    );
    return { id: challengeId, publishedAsTemplate: false };
  });
}

export async function duplicateTemplate(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  const targetGroupId = stringValue(body, "targetGroupId", { min: 1, max: 100 })!;
  return inTransaction(async (client) => {
    const template = await oneOrNull<{ id: string; group_id: string; title: string; recipe_key: string | null }>(
      client,
      `SELECT id, group_id, title, recipe_key FROM challenges
        WHERE id = $1 AND published_as_template_at IS NOT NULL AND deleted_at IS NULL
        FOR UPDATE`,
      [challengeId],
    );
    if (!template) throw new ApiError(404, "not_found", "Modelo não encontrado.");
    if (!isRecipeKey(template.recipe_key)) {
      throw new ApiError(409, "legacy_recipe_read_only", "Este modelo antigo não pode criar um novo desafio.");
    }

    await requireGroupRole(session.user.id, targetGroupId, ["owner", "admin"], client);
    const targetGroup = await oneOrNull<{ id: string }>(
      client,
      `SELECT id FROM groups
        WHERE id = $1 AND kind = 'standard' AND archived_at IS NULL AND deleted_at IS NULL
        FOR UPDATE`,
      [targetGroupId],
    );
    if (!targetGroup) throw new ApiError(404, "not_found", "Grupo de destino não encontrado.");

    const targetCount = await oneOrNull<{ count: number }>(
      client,
      "SELECT count(*)::int AS count FROM challenges WHERE group_id = $1 AND deleted_at IS NULL",
      [targetGroupId],
    );
    assertUnder(
      targetCount?.count ?? 0,
      LIMITS.challengesPerGroup,
      "challenge_limit",
      `O grupo de destino atingiu o limite de ${LIMITS.challengesPerGroup} desafios.`,
    );

    const title = stringValue(body, "title", { max: 160, optional: true }) ?? template.title;
    const targetId = await copyChallengeStructure(
      client,
      template.id,
      targetGroupId,
      session.user.id,
      title,
    );
    await client.query(
      `INSERT INTO challenge_duplications
        (source_group_id,target_group_id,source_challenge_id,target_challenge_id,copied_by_user_id,created_at)
       VALUES ($1,$2,$3,$4,$5,now())`,
      [template.group_id, targetGroupId, template.id, targetId, session.user.id],
    );
    await writeAudit(
      client,
      targetGroupId,
      targetId,
      session.user.id,
      "challenge.duplicated",
      "challenge",
      targetId,
      null,
      { sourceChallengeId: template.id, fromTemplate: true, targetGroupId },
    );
    return { id: targetId, challengeId: targetId, groupId: targetGroupId, status: "draft" };
  });
}
