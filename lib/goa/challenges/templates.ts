import type { PoolClient } from "pg";

import { requireGroupRole, type SessionContext } from "../../auth";
import { inTransaction, oneOrNull, withClient } from "../../db";
import { challengeAccess, writeAudit } from "../../goa-domain";
import { ApiError, stringValue } from "../../http";
import { assertUnder, LIMITS } from "../../limits";
import { parseRuleSections } from "../domain/rules";
import { copyChallengeStructure } from "./copy";
import { fieldsForChallenge } from "./fields";

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
  start_date: string;
  end_date: string;
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
      `SELECT c.id, c.title, c.description, c.template_summary AS summary,
              c.rules, c.rule_sections, c.start_date::text AS start_date,
              c.end_date::text AS end_date, c.published_as_template_at,
              (SELECT et.submission_mode FROM entry_types et
                WHERE et.challenge_id = c.id AND et.archived_at IS NULL
                ORDER BY et.created_at LIMIT 1) AS submission_mode,
              (SELECT count(*)::int FROM challenge_fields f
                WHERE f.challenge_id = c.id AND f.archived_at IS NULL) AS field_count,
              (SELECT count(*)::int FROM challenge_items i
                WHERE i.challenge_id = c.id AND i.archived_at IS NULL) AS item_count,
              (SELECT count(*)::int FROM challenge_metrics m
                WHERE m.challenge_id = c.id AND m.archived_at IS NULL) AS metric_count
         FROM challenges c
         JOIN groups g ON g.id = c.group_id AND g.deleted_at IS NULL AND g.archived_at IS NULL
        WHERE c.published_as_template_at IS NOT NULL AND c.deleted_at IS NULL
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

async function templateRowById(client: PoolClient, challengeId: string) {
  return oneOrNull<{
    id: string; title: string; description: string | null; summary: string | null;
    rules: string | null; rule_sections: unknown; start_date: string; end_date: string;
    submission_mode: "item" | "daily" | "free" | null;
  }>(
    client,
    `SELECT c.id, c.title, c.description, c.template_summary AS summary, c.rules,
            c.rule_sections, c.start_date::text AS start_date, c.end_date::text AS end_date,
            (SELECT et.submission_mode FROM entry_types et
              WHERE et.challenge_id = c.id AND et.archived_at IS NULL
              ORDER BY et.created_at LIMIT 1) AS submission_mode
       FROM challenges c
       JOIN groups g ON g.id = c.group_id AND g.deleted_at IS NULL AND g.archived_at IS NULL
      WHERE c.id = $1 AND c.published_as_template_at IS NOT NULL AND c.deleted_at IS NULL`,
    [challengeId],
  );
}

export async function getTemplateDetail(challengeId: string) {
  return withClient(async (client) => {
    const template = await templateRowById(client, challengeId);
    if (!template) throw new ApiError(404, "not_found", "Modelo não encontrado.");

    const fields = await fieldsForChallenge(client, challengeId);
    const items = await client.query<{
      title: string; description: string | null; position: number;
    }>(
      `SELECT title, description, position FROM challenge_items
        WHERE challenge_id = $1 AND archived_at IS NULL ORDER BY position`,
      [challengeId],
    );
    const checkpoints = await client.query<{ title: string; description: string | null; position: number }>(
      `SELECT title, description, position FROM challenge_checkpoints
        WHERE challenge_id = $1 AND archived_at IS NULL ORDER BY position`,
      [challengeId],
    );
    const metrics = await client.query<{
      label: string; operation: string; group_by: string;
    }>(
      `SELECT label, operation, group_by FROM challenge_metrics
        WHERE challenge_id = $1 AND archived_at IS NULL ORDER BY position`,
      [challengeId],
    );

    const structure = items.rows.length ? items.rows : checkpoints.rows;
    return {
      id: template.id,
      title: template.title,
      description: template.description,
      summary: template.summary,
      ruleSections: parseRuleSections(template.rule_sections, template.rules),
      submissionMode: template.submission_mode ?? "free",
      durationDays:
        Math.round(
          (Date.parse(`${template.end_date}T00:00:00Z`) - Date.parse(`${template.start_date}T00:00:00Z`))
            / 86_400_000,
        ) + 1,
      fields: fields.map((field) => ({
        label: field.label,
        type: field.kind === "choice" ? "select" : field.kind,
        required: field.required === true,
        options: Array.isArray(field.options)
          ? (field.options as Array<{ label: string }>).map((option) => option.label)
          : [],
      })),
      items: structure.map((entry) => ({ title: entry.title, description: entry.description })),
      metrics: metrics.rows.map((metric) => ({
        label: metric.label,
        operation: metric.operation,
        groupBy: metric.group_by,
      })),
    };
  });
}

export async function setChallengeTemplate(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  if (!session.user.platformAdmin) {
    throw new ApiError(403, "forbidden", "Somente a administração da plataforma publica modelos.");
  }
  const summary = stringValue(body, "summary", { max: 280, optional: true }) ?? null;
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) {
      throw new ApiError(403, "forbidden", "Você precisa administrar este desafio.");
    }
    const updated = await oneOrNull<{ published_as_template_at: Date | null }>(
      client,
      `UPDATE challenges
          SET published_as_template_at = COALESCE(published_as_template_at, now()),
              template_summary = $2,
              updated_at = now()
        WHERE id = $1
      RETURNING published_as_template_at`,
      [challengeId, summary],
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
      { summary },
    );
    return {
      id: challengeId,
      publishedAsTemplate: true,
      summary,
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
      `UPDATE challenges SET published_as_template_at = NULL, template_summary = NULL, updated_at = now()
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
    const template = await oneOrNull<{ id: string; group_id: string; title: string }>(
      client,
      `SELECT id, group_id, title FROM challenges
        WHERE id = $1 AND published_as_template_at IS NOT NULL AND deleted_at IS NULL
        FOR UPDATE`,
      [challengeId],
    );
    if (!template) throw new ApiError(404, "not_found", "Modelo não encontrado.");

    await requireGroupRole(session.user.id, targetGroupId, ["owner", "admin"], client);
    const targetGroup = await oneOrNull<{ id: string }>(
      client,
      `SELECT id FROM groups
        WHERE id = $1 AND archived_at IS NULL AND deleted_at IS NULL
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
