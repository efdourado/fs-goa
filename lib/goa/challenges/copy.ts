import type { PoolClient } from "pg";

import { publicId } from "../../goa-domain";
import { linkChallengeLibrary, readChallengeLibraries } from "./libraries";
import type { FieldRow, MetricRow } from "./types";

/**
 * A property that could not come across because the destination library already
 * has one under the same internal key that means something else. The copy keeps
 * the destination's definition untouched and leaves this property — and its
 * values — out, rather than push a value into a property of another type.
 */
export interface SkippedProperty {
  library: { kind: string; label: string | null; source: string };
  key: string;
  label: string;
  type: string;
  reason: "type_mismatch" | "archived";
  /** `type_mismatch` only: what the destination's property of that key holds. */
  existingType: string | null;
}

/**
 * Recreates one library in the target group with the same starting config, name
 * and properties. A library the target already has is left as its owners set it
 * up — the copy only adds custom properties it is missing (so copied values have
 * somewhere to live) and never overwrites their names, order or visibility. The
 * copy is a separate row: renaming either side never touches the other.
 *
 * A property the target already defines under the same key is a conflict when its
 * type differs (or it was archived there): it is skipped and reported back.
 */
async function copyLibrary(
  client: PoolClient,
  sourceGroupId: string,
  targetGroupId: string,
  kind: string,
  actorUserId: string,
): Promise<SkippedProperty[]> {
  const conflicts = await client.query<{
    key: string; label: string; type: string; target_type: string; archived: boolean;
    library_label: string | null; library_source: string;
  }>(
    `SELECT d.semantic_key AS key, d.label, d.type, t.type AS target_type, (t.archived_at IS NOT NULL) AS archived,
            cl.label AS library_label, cl.source AS library_source
       FROM catalog_attribute_defs d
       JOIN catalog_attribute_defs t
         ON t.group_id = $2 AND t.kind = d.kind AND t.semantic_key = d.semantic_key
       JOIN catalog_libraries cl ON cl.group_id = d.group_id AND cl.kind = d.kind
      WHERE d.group_id = $1 AND d.kind = $3 AND d.archived_at IS NULL
        AND (t.archived_at IS NOT NULL OR t.type <> d.type)
      ORDER BY d.position`,
    [sourceGroupId, targetGroupId, kind],
  );
  const skipped: SkippedProperty[] = conflicts.rows.map((row) => ({
    library: { kind, label: row.library_label, source: row.library_source },
    key: row.key, label: row.label, type: row.type,
    reason: row.archived ? "archived" : "type_mismatch",
    existingType: row.archived ? null : row.target_type,
  }));
  const created = await client.query<{ id: string }>(
    `INSERT INTO catalog_libraries (id, group_id, kind, source, label, position, created_by_user_id, created_at, updated_at)
     SELECT gen_random_uuid()::text, $2, cl.kind, cl.source, cl.label, cl.position, $3, now(), now()
       FROM catalog_libraries cl WHERE cl.group_id = $1 AND cl.kind = $4
     ON CONFLICT (group_id, kind) DO NOTHING
     RETURNING id`,
    [sourceGroupId, targetGroupId, actorUserId, kind],
  );
  if (created.rows[0]) {
    // Renamed or hidden built-in columns (year, pages…) come along with a brand-new library only.
    await client.query(
      `INSERT INTO catalog_native_property_configs (id, library_id, property_key, label, hidden, position, created_at, updated_at)
       SELECT gen_random_uuid()::text, $2, n.property_key, n.label, n.hidden, n.position, now(), now()
         FROM catalog_native_property_configs n
         JOIN catalog_libraries cl ON cl.id = n.library_id AND cl.group_id = $1 AND cl.kind = $3`,
      [sourceGroupId, created.rows[0].id, kind],
    );
  } else {
    // A library the target already had keeps its own configuration — except the event date
    // switch: copied items carry their dates, and they'd be stored but invisible without it.
    await client.query(
      `INSERT INTO catalog_native_property_configs (id, library_id, property_key, label, hidden, position, created_at, updated_at)
       SELECT gen_random_uuid()::text, tl.id, n.property_key, n.label, n.hidden, n.position, now(), now()
         FROM catalog_native_property_configs n
         JOIN catalog_libraries sl ON sl.id = n.library_id AND sl.group_id = $1 AND sl.kind = $3
         JOIN catalog_libraries tl ON tl.group_id = $2 AND tl.kind = $3
        WHERE n.property_key = 'scheduled_at' AND n.hidden = false
       ON CONFLICT (library_id, property_key) DO NOTHING`,
      [sourceGroupId, targetGroupId, kind],
    );
  }
  await client.query(
    `INSERT INTO catalog_attribute_defs
       (id, group_id, kind, semantic_key, label, type, position, hidden, created_by_user_id, created_at, updated_at)
     SELECT gen_random_uuid()::text, $2, d.kind, d.semantic_key, d.label, d.type, d.position, d.hidden, $3, now(), now()
       FROM catalog_attribute_defs d
      WHERE d.group_id = $1 AND d.kind = $4 AND d.archived_at IS NULL
     ON CONFLICT (group_id, kind, semantic_key) DO NOTHING`,
    [sourceGroupId, targetGroupId, actorUserId, kind],
  );
  return skipped;
}

/**
 * Copies a challenge's structure — rules, entry types (with who may see and who
 * may fill each answer), fields and their options, the libraries it draws from
 * (their properties, not their items), the manual checkpoint layout, and metric
 * definitions — into `targetGroupId` as a fresh `draft`. The recipe carries over;
 * the challenge's participation **period** does not (the copy starts undated, so
 * the admin picks new ones). The item list never comes across: the new owners add
 * their own from their library. Day-by-day checkpoints are left out — those
 * regenerate from the period. No items, entries, participants, results, or share tokens come across.
 *
 * Shared by "duplicate this challenge" and "duplicate this template". Callers own
 * every access check and their own audit/bookkeeping rows; this function only
 * writes the structural copy and returns the new challenge id, plus any library
 * properties it had to leave out because the destination defines them differently.
 */
export async function copyChallengeStructure(
  client: PoolClient,
  sourceChallengeId: string,
  targetGroupId: string,
  createdByUserId: string,
  title: string,
): Promise<{ id: string; skippedProperties: SkippedProperty[]; status: "draft" }> {
  const targetId = publicId();
  const skippedProperties: SkippedProperty[] = [];
  const copyLibraryAndRemember = async (sourceGroupId: string, kind: string, createdBy: string) => {
    skippedProperties.push(...await copyLibrary(client, sourceGroupId, targetGroupId, kind, createdBy));
  };
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

  // The libraries this challenge draws from come along with their properties (not their items), so a
  // restaurant or match template keeps the fields that made it useful, empty for the new owners to fill.
  const origin = (await client.query<{ group_id: string; recipe_key: string | null }>(
    "SELECT group_id, recipe_key FROM challenges WHERE id=$1", [sourceChallengeId])).rows[0];
  const sourceGroupId = origin.group_id;
  const linkedKinds = new Set<string>();
  for (const library of await readChallengeLibraries(client, sourceChallengeId, sourceGroupId, origin.recipe_key)) {
    await copyLibraryAndRemember(sourceGroupId, library.kind, createdByUserId);
    await linkChallengeLibrary(client, targetId, targetGroupId, library.kind, createdByUserId);
    linkedKinds.add(library.kind);
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
  return { id: targetId, skippedProperties, status: "draft" as const };
}
