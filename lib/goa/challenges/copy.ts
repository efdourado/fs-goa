import type { PoolClient } from "pg";

import { publicId } from "../../goa-domain";
import { ApiError } from "../../http";
import { addCatalogItem } from "../catalog";
import { setCatalogItemAttributeValues } from "../catalog-attributes";
import { linkChallengeLibrary, readChallengeLibraries } from "./libraries";
import type { FieldRow, MetricRow } from "./types";

/**
 * "Structure only" leaves the copy without items — the admin adds their own
 * (Phase 7); "structure + items" also carries the round's items. Copying items
 * stays the default so existing callers keep their behavior.
 */
export function readCopyMode(body: Record<string, unknown>): { copyItems: boolean; mode: "structure" | "structure_and_items" } {
  const mode = body.mode ?? "structure_and_items";
  if (mode !== "structure" && mode !== "structure_and_items") {
    throw new ApiError(400, "invalid_copy_mode", "Escolha copiar só a estrutura ou a estrutura com os itens.");
  }
  return { copyItems: mode === "structure_and_items", mode };
}

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
 * type differs (or it was archived there): it is skipped, reported back, and
 * `copyAttributeValues` leaves its values out too.
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
 * Carries a catalog item's custom property values to its copy. Only values the
 * target item doesn't already have — a film or book that already existed in the
 * target keeps what its owners entered, as every other field of a matched item does.
 */
async function copyAttributeValues(
  client: PoolClient,
  sourceCatalogItemId: string,
  targetCatalogItemId: string,
  targetGroupId: string,
  kind: string,
  skipKeys: ReadonlySet<string>,
): Promise<void> {
  const values = await client.query<{
    key: string; type: string; text_value: string | null; number_value: number | null;
    date_value: string | null; boolean_value: boolean | null;
  }>(
    `SELECT d.semantic_key AS key, d.type, v.text_value, v.number_value, v.date_value::text AS date_value, v.boolean_value
       FROM catalog_attribute_values v
       JOIN catalog_attribute_defs d ON d.id = v.attribute_def_id AND d.archived_at IS NULL
      WHERE v.catalog_item_id = $1`,
    [sourceCatalogItemId],
  );
  if (!values.rows.length) return;
  const have = new Set((await client.query<{ key: string }>(
    `SELECT d.semantic_key AS key FROM catalog_attribute_values v
       JOIN catalog_attribute_defs d ON d.id = v.attribute_def_id WHERE v.catalog_item_id = $1`,
    [targetCatalogItemId],
  )).rows.map((row) => row.key));
  const missing: Record<string, string | number | boolean> = {};
  for (const row of values.rows) {
    if (have.has(row.key) || skipKeys.has(row.key)) continue;
    const value = row.type === "number" ? row.number_value
      : row.type === "date" ? row.date_value
      : row.type === "boolean" ? row.boolean_value
      : row.text_value;
    if (value !== null) missing[row.key] = value;
  }
  if (Object.keys(missing).length) {
    await setCatalogItemAttributeValues(client, targetCatalogItemId, targetGroupId, kind, missing, { includeHidden: true });
  }
}

/**
 * Copies a challenge's structure — rules, entry types (with who may see and who
 * may fill each answer), fields and their options, the libraries it draws from,
 * round items (with their week/session/milestone assignment and their own
 * schedule), the manual checkpoint layout, and metric definitions — into
 * `targetGroupId` as a fresh `draft`. The recipe carries over; the challenge's
 * participation **period** does not (the copy starts undated, so the admin picks
 * new ones), but an item's own event dates do — a match's kickoff is part of what
 * the template is. Round items re-resolve against the target group's catalog
 * (skipped entirely for a "structure only" copy, which still recreates the
 * libraries and their properties). Day-by-day checkpoints are left out — those
 * regenerate from the period. No entries, participants, results, share tokens, or
 * recommenders (member, saved name, or note) come across.
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
  options: { copyItems?: boolean } = {},
): Promise<{ id: string; skippedProperties: SkippedProperty[] }> {
  const copyItems = options.copyItems !== false;
  const targetId = publicId();
  const skippedProperties: SkippedProperty[] = [];
  const skippedKeys = new Map<string, Set<string>>();
  const copyLibraryAndRemember = async (sourceGroupId: string, kind: string, createdBy: string) => {
    const skipped = await copyLibrary(client, sourceGroupId, targetGroupId, kind, createdBy);
    skippedProperties.push(...skipped);
    skippedKeys.set(kind, new Set(skipped.map((property) => property.key)));
  };
  await client.query(
    `INSERT INTO challenges
      (id,group_id,created_by_user_id,title,description,rules,rule_sections,recipe_key,recipe_version,
       start_date,end_date,time_zone,collects_entry_date,status,created_at,updated_at)
     SELECT $1,$2,$3,$4,description,rules,rule_sections,recipe_key,recipe_version,
            NULL,NULL,time_zone,collects_entry_date,'draft',now(),now()
       FROM challenges WHERE id=$5`,
    [targetId, targetGroupId, createdByUserId, title, sourceChallengeId],
  );

  const typeMap = new Map<string, string>();
  const sourceTypes = await client.query<{
    id: string; semantic_key: string; name: string; description: string | null; submission_mode: string;
    purpose: string | null; target_policy: string | null; cardinality: string | null; schedule_policy: string | null;
    is_primary: boolean; answer_scope: string; shared_edit_policy: string | null; visibility_policy: string;
  }>(
    `SELECT id,semantic_key,name,description,submission_mode,purpose,target_policy,cardinality,schedule_policy,is_primary,
            answer_scope,shared_edit_policy,visibility_policy
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

  // The libraries this challenge draws from come along with their properties, so a
  // restaurant or match template keeps the fields that made it useful — even for
  // a "structure only" copy, which just has no items in them yet.
  const origin = (await client.query<{ group_id: string; recipe_key: string | null }>(
    "SELECT group_id, recipe_key FROM challenges WHERE id=$1", [sourceChallengeId])).rows[0];
  const sourceGroupId = origin.group_id;
  const linkedKinds = new Set<string>();
  for (const library of await readChallengeLibraries(client, sourceChallengeId, sourceGroupId, origin.recipe_key)) {
    await copyLibraryAndRemember(sourceGroupId, library.kind, createdByUserId);
    await linkChallengeLibrary(client, targetId, targetGroupId, library.kind, createdByUserId);
    linkedKinds.add(library.kind);
  }

  if (copyItems) {
    const sourceItems = await client.query<{
      entry_type_id: string | null; checkpoint_id: string | null; semantic_key: string; title: string;
      description: string | null; position: number; metadata: unknown;
      opens_at: Date | null; due_at: Date | null; schedule_precision: string;
      catalog_kind: string | null; catalog_title: string | null; catalog_author: string | null;
      catalog_year: number | null; catalog_main_genre: string | null; catalog_pages: number | null;
      catalog_runtime: number | null; catalog_item_id: string | null;
    }>(
      `SELECT i.entry_type_id,i.checkpoint_id,i.semantic_key,i.title,i.description,i.position,i.metadata,i.catalog_item_id,
              i.opens_at,i.due_at,i.schedule_precision,
              ci.kind AS catalog_kind, ci.title AS catalog_title, ci.author AS catalog_author, ci.year AS catalog_year,
              ci.main_genre AS catalog_main_genre, ci.page_count AS catalog_pages, ci.runtime_minutes AS catalog_runtime
         FROM challenge_items i
         LEFT JOIN catalog_items ci ON ci.id = i.catalog_item_id
        WHERE i.challenge_id=$1 AND i.archived_at IS NULL ORDER BY i.position`, [sourceChallengeId]);

    for (const item of sourceItems.rows) {
      // Re-resolve the item against the target group's own catalog — the
      // source catalog id belongs to another group. Recommenders don't carry.
      // film/book keep their existing auto-match; every other kind always
      // becomes a new item in the target's catalog, never merged onto
      // something already there by title (a title match is never silent
      // identity outside film/book).
      let catalogItemId: string | null = null;
      if (item.catalog_item_id && item.catalog_kind) {
        catalogItemId = (await addCatalogItem(client, targetGroupId, createdByUserId, {
          kind: item.catalog_kind,
          title: item.catalog_title ?? item.title,
          author: item.catalog_author,
          year: item.catalog_year,
          mainGenre: item.catalog_main_genre,
          pageCount: item.catalog_pages,
          runtimeMinutes: item.catalog_runtime,
        })).id;
        if (!linkedKinds.has(item.catalog_kind)) {
          await copyLibraryAndRemember(sourceGroupId, item.catalog_kind, createdByUserId);
          await linkChallengeLibrary(client, targetId, targetGroupId, item.catalog_kind, createdByUserId);
          linkedKinds.add(item.catalog_kind);
        }
        await copyAttributeValues(
          client, item.catalog_item_id, catalogItemId, targetGroupId, item.catalog_kind,
          skippedKeys.get(item.catalog_kind) ?? new Set(),
        );
        // The item's own date and time comes along too, unless the item already had one in the target.
        await client.query(
          `UPDATE catalog_items t
              SET scheduled_at = s.scheduled_at, scheduled_end_at = s.scheduled_end_at,
                  scheduled_precision = s.scheduled_precision, scheduled_time_zone = s.scheduled_time_zone, updated_at = now()
             FROM catalog_items s
            WHERE s.id = $1 AND t.id = $2 AND s.scheduled_at IS NOT NULL AND t.scheduled_at IS NULL`,
          [item.catalog_item_id, catalogItemId],
        );
      }
      await client.query(
        `INSERT INTO challenge_items
          (id,challenge_id,entry_type_id,checkpoint_id,catalog_item_id,semantic_key,title,description,position,
           opens_at,due_at,schedule_precision,metadata,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,now(),now())`,
        [publicId(), targetId,
          item.entry_type_id ? typeMap.get(item.entry_type_id) : null,
          item.checkpoint_id ? checkpointMap.get(item.checkpoint_id) ?? null : null,
          catalogItemId,
          item.semantic_key, item.title, item.description,
          item.position, item.opens_at, item.due_at, item.schedule_precision, JSON.stringify(item.metadata ?? {})],
      );
    }
  }

  const metrics = await client.query<MetricRow>(
    `SELECT id,challenge_id,entry_type_id,field_id,semantic_key,label,operation,group_by,
            decimal_places,visible_during_challenge,position,settings
       FROM challenge_metrics WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY position`, [sourceChallengeId]);
  for (const source of metrics.rows) {
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
      [publicId(), targetId, typeMap.get(source.entry_type_id), source.field_id ? fieldMap.get(source.field_id) : null,
        source.semantic_key, source.label, source.operation, source.group_by, source.decimal_places,
        source.visible_during_challenge, source.position, JSON.stringify(settings), createdByUserId],
    );
  }

  return { id: targetId, skippedProperties };
}
