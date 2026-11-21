import type { PoolClient } from "pg";

import { publicId } from "../../goa-domain";
import type { FieldRow, MetricRow } from "./types";

/**
 * Copies a challenge's structure — rules, entry types (with who may see and who
 * may fill each answer), fields and their options, the manual checkpoint layout,
 * and metric definitions — into `targetGroupId` as a fresh `draft`. The recipe carries over;
 * the challenge's participation **period** does not (the copy starts undated, so
 * the admin picks new ones). The item list never comes across: the new owners add
 * their own from their library. Day-by-day checkpoints are left out — those
 * regenerate from the period. No items, entries, participants, results, or share tokens come across.
 *
 * No library comes across either, nor is one made in the target: the copy's owner
 * picks it (the duplicate dialog, or the first time they add items), offered the
 * source's library by name (see `librarySuggestion`).
 *
 * Shared by "duplicate this challenge" and "duplicate this template". Callers own
 * every access check and their own audit/bookkeeping rows; this function only
 * writes the structural copy and returns the new challenge id.
 */
export async function copyChallengeStructure(
  client: PoolClient,
  sourceChallengeId: string,
  targetGroupId: string,
  createdByUserId: string,
  title: string,
): Promise<{ id: string; status: "draft" }> {
  const targetId = publicId();
  await client.query(
    `INSERT INTO challenges
      (id,group_id,created_by_user_id,title,description,rules,rule_sections,recipe_key,recipe_version,
       start_date,end_date,time_zone,status,created_at,updated_at)
     SELECT $1,$2,$3,$4,description,rules,rule_sections,recipe_key,recipe_version,
            NULL,NULL,time_zone,'draft',now(),now()
       FROM challenges WHERE id=$5`,
    [targetId, targetGroupId, createdByUserId, title, sourceChallengeId],
  );

  const typeMap = new Map<string, string>();
  const sourceTypes = await client.query<{
    id: string; semantic_key: string; name: string; description: string | null; submission_mode: string;
    purpose: string | null; target_policy: string | null; cardinality: string | null; schedule_policy: string | null;
    is_primary: boolean; answer_scope: string; shared_edit_policy: string | null; visibility_policy: string;
    parent_type_id: string | null;
  }>(
    `SELECT id,semantic_key,name,description,submission_mode,purpose,target_policy,cardinality,schedule_policy,is_primary,
            answer_scope,shared_edit_policy,visibility_policy,parent_type_id
       FROM entry_types WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY created_at`,
    [sourceChallengeId]);
  for (const source of sourceTypes.rows) {
    const id = publicId();
    typeMap.set(source.id, id);
    await client.query(
      `INSERT INTO entry_types
        (id,challenge_id,semantic_key,name,description,submission_mode,purpose,target_policy,cardinality,schedule_policy,is_primary,
         answer_scope,shared_edit_policy,visibility_policy,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now(),now())`,
      [id, targetId, source.semantic_key, source.name, source.description, source.submission_mode,
        source.purpose, source.target_policy, source.cardinality, source.schedule_policy, source.is_primary,
        source.answer_scope, source.shared_edit_policy, source.visibility_policy],
    );
  }
  // A type that lives inside another (a workout's exercise records) keeps pointing at its copy of it.
  for (const source of sourceTypes.rows) {
    if (!source.parent_type_id || !typeMap.has(source.parent_type_id)) continue;
    await client.query(
      "UPDATE entry_types SET parent_type_id=$3 WHERE id=$2 AND challenge_id=$1",
      [targetId, typeMap.get(source.id), typeMap.get(source.parent_type_id)]);
  }

  const fieldMap = new Map<string, string>();
  const sourceFields = await client.query<FieldRow>(
    `SELECT id,challenge_id,entry_type_id,semantic_key,label,help_text,kind,required,position,
            number_scale,min_scaled,max_scaled,step_scaled,max_length,settings
       FROM challenge_fields WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY position`, [sourceChallengeId]);
  for (const source of sourceFields.rows) {
    const id = publicId();
    fieldMap.set(source.id, id);
    await client.query(
      `INSERT INTO challenge_fields
        (id,challenge_id,entry_type_id,semantic_key,label,help_text,kind,required,position,
         number_scale,min_scaled,max_scaled,step_scaled,max_length,settings,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,now(),now())`,
      [id, targetId, typeMap.get(source.entry_type_id), source.semantic_key, source.label,
        source.help_text, source.kind, source.required, source.position, source.number_scale,
        source.min_scaled, source.max_scaled, source.step_scaled, source.max_length, JSON.stringify(source.settings ?? {})],
    );
    const options = await client.query<{
      semantic_key: string; label: string; position: number;
    }>("SELECT semantic_key,label,position FROM field_options WHERE field_id=$1 AND archived_at IS NULL ORDER BY position", [source.id]);
    for (const option of options.rows) {
      await client.query(
        `INSERT INTO field_options (id,field_id,semantic_key,label,position,created_at)
         VALUES ($1,$2,$3,$4,$5,now())`,
        [publicId(), id, option.semantic_key, option.label, option.position],
      );
    }
  }

  const trackingSource = await client.query<{ tracking_settings: import("../../progress-tracking").ProgressTracking }>(
    "SELECT tracking_settings FROM challenges WHERE id=$1", [sourceChallengeId]);
  const tracking = trackingSource.rows[0]?.tracking_settings ?? {};
  if (tracking.performance) tracking.performance.fieldIds = tracking.performance.fieldIds.flatMap((id) => fieldMap.has(id) ? [fieldMap.get(id)!] : []);
  if (tracking.performance?.rules) tracking.performance.rules = Object.fromEntries(Object.entries(tracking.performance.rules).flatMap(([id, rule]) =>
    fieldMap.has(id) ? [[fieldMap.get(id)!, { ...rule, ...(rule.contextFieldId ? { contextFieldId: fieldMap.get(rule.contextFieldId) } : {}) }]] : []));
  if (tracking.performance?.seriesFieldId) tracking.performance.seriesFieldId = fieldMap.get(tracking.performance.seriesFieldId);
  await client.query("UPDATE challenges SET tracking_settings=$2::jsonb WHERE id=$1", [targetId, JSON.stringify(tracking)]);

  // The manual checkpoint layout (weeks, sessions, milestones) is the structural
  // promise a template makes — "six weeks, two films each". Carry it, but drop
  // the absolute dates: the copy is undated, so the admin sets a fresh period (or
  // leaves it open) and the schedule follows. Day-by-day checkpoints are skipped
  // — those are derived from the period and regenerate on the copy.
  const checkpointMap = new Map<string, string>();
  const sourceCheckpoints = await client.query<{
    id: string; semantic_key: string; title: string; description: string | null;
    kind: string; position: number;
  }>(
    `SELECT id,semantic_key,title,description,kind,position
       FROM challenge_checkpoints
      WHERE challenge_id=$1 AND archived_at IS NULL AND kind <> 'day'
      ORDER BY position`, [sourceChallengeId]);
  for (const source of sourceCheckpoints.rows) {
    const id = publicId();
    checkpointMap.set(source.id, id);
    await client.query(
      `INSERT INTO challenge_checkpoints
        (id,challenge_id,semantic_key,title,description,kind,position,starts_at,due_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,NULL,now(),now())`,
      [id, targetId, source.semantic_key, source.title, source.description, source.kind, source.position],
    );
  }

  // The item list never comes across: items belong to the source group's library, and copying them would add
  // titles to the target's library behind its owners' backs. The new owners add their own.

  const metrics = await client.query<MetricRow>(
    `SELECT id,challenge_id,entry_type_id,field_id,semantic_key,label,operation,group_by,
            decimal_places,visible_during_challenge,position,settings
       FROM challenge_metrics WHERE challenge_id=$1 AND archived_at IS NULL AND operation <> 'indicator_bias' ORDER BY position`, [sourceChallengeId]);
  const metricMap = new Map<string, string>();
  for (const source of metrics.rows) {
    const copiedMetricId = publicId();
    metricMap.set(source.id, copiedMetricId);
    // `settings.fieldIds` (a multi-field metric, e.g. Tables' "Nota geral") names fields by id — those ids
    // belong to the source challenge, so they need the same remap `field_id` itself just got.
    const sourceSettings = (source.settings ?? {}) as { fieldIds?: unknown };
    const fieldIds = Array.isArray(sourceSettings.fieldIds)
      ? sourceSettings.fieldIds
        .filter((fieldId): fieldId is string => typeof fieldId === "string")
        .map((fieldId) => fieldMap.get(fieldId))
        .filter((fieldId): fieldId is string => Boolean(fieldId))
      : null;
    const settings = fieldIds ? { ...sourceSettings, fieldIds } : sourceSettings;
    await client.query(
      `INSERT INTO challenge_metrics
        (id,challenge_id,entry_type_id,field_id,semantic_key,label,operation,group_by,
         decimal_places,visible_during_challenge,position,settings,created_by_user_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,now(),now())`,
      [copiedMetricId, targetId, typeMap.get(source.entry_type_id), source.field_id ? fieldMap.get(source.field_id) : null,
        source.semantic_key, source.label, source.operation, source.group_by, source.decimal_places,
        source.visible_during_challenge, source.position, JSON.stringify(settings), createdByUserId],
    );
  }

  if (tracking.results) {
    const remapPage = (id: string) => id.startsWith("metric-") ? (metricMap.has(id.slice(7)) ? [`metric-${metricMap.get(id.slice(7))}`] : []) : [id];
    tracking.results = { hiddenPages: tracking.results.hiddenPages.flatMap(remapPage), pageOrder: tracking.results.pageOrder.flatMap(remapPage) };
    await client.query("UPDATE challenges SET tracking_settings=$2::jsonb WHERE id=$1", [targetId, JSON.stringify(tracking)]);
  }

  // Every copy is born a draft, to be looked over (and given its items) before it starts. A copy into a group starts
  // with no participants (the people there may not be the same; they're picked again). A copy into one's own space
  // has its owner in it already, since a personal space has no one else to pick: they switch it on when ready.
  await client.query(
    `INSERT INTO challenge_participants (challenge_id, group_id, user_id, added_by_user_id, joined_at)
     SELECT $1, $2, $3, $3, now() WHERE EXISTS (SELECT 1 FROM groups WHERE id = $2 AND kind = 'personal')
     ON CONFLICT DO NOTHING`,
    [targetId, targetGroupId, createdByUserId],
  );
  return { id: targetId, status: "draft" as const };
}
