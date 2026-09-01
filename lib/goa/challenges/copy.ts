import type { PoolClient } from "pg";

import { publicId } from "../../goa-domain";
import { resolveTags, setCatalogItemTags, upsertCatalogItem } from "../catalog";
import type { FieldRow, MetricRow } from "./types";

/**
 * Copies a challenge's structure — rules, entry types, fields and their options,
 * round items, and metric definitions — into `targetGroupId` as a fresh `draft`.
 * The recipe carries over; the schedule does not (the copy starts undated, so the
 * admin picks new dates and checkpoints regenerate), and round items re-resolve
 * against the target group's catalog. No entries, participants, checkpoints,
 * results, share tokens, or recommenders come across.
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
): Promise<string> {
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
    is_primary: boolean;
  }>(
    `SELECT id,semantic_key,name,description,submission_mode,purpose,target_policy,cardinality,schedule_policy,is_primary
       FROM entry_types WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY created_at`,
    [sourceChallengeId]);
  for (const source of sourceTypes.rows) {
    const id = publicId();
    typeMap.set(source.id, id);
    await client.query(
      `INSERT INTO entry_types
        (id,challenge_id,semantic_key,name,description,submission_mode,purpose,target_policy,cardinality,schedule_policy,is_primary,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now())`,
      [id, targetId, source.semantic_key, source.name, source.description, source.submission_mode,
        source.purpose, source.target_policy, source.cardinality, source.schedule_policy, source.is_primary],
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

  const sourceItems = await client.query<{
    entry_type_id: string | null; semantic_key: string; title: string;
    description: string | null; position: number; metadata: unknown;
    catalog_kind: string | null; catalog_title: string | null; catalog_author: string | null;
    catalog_year: number | null; catalog_runtime: number | null; catalog_pages: number | null;
    catalog_item_id: string | null;
  }>(
    `SELECT i.entry_type_id,i.semantic_key,i.title,i.description,i.position,i.metadata,i.catalog_item_id,
            ci.kind AS catalog_kind, ci.title AS catalog_title, ci.author AS catalog_author, ci.year AS catalog_year,
            ci.runtime_minutes AS catalog_runtime, ci.page_count AS catalog_pages
       FROM challenge_items i
       LEFT JOIN catalog_items ci ON ci.id = i.catalog_item_id
      WHERE i.challenge_id=$1 AND i.archived_at IS NULL ORDER BY i.position`, [sourceChallengeId]);
  for (const source of sourceItems.rows) {
    // Re-resolve the film/book against the target group's own catalog — the
    // source catalog id belongs to another group. Recommenders don't carry.
    let catalogItemId: string | null = null;
    if (source.catalog_item_id && source.catalog_kind) {
      catalogItemId = await upsertCatalogItem(client, targetGroupId, createdByUserId, {
        kind: source.catalog_kind as "film" | "book" | "other",
        title: source.catalog_title ?? source.title,
        author: source.catalog_author,
        year: source.catalog_year,
        runtimeMinutes: source.catalog_runtime,
        pageCount: source.catalog_pages,
      });
      const genres = await client.query<{ label: string }>(
        `SELECT ct.label FROM catalog_item_tags cit JOIN catalog_tags ct ON ct.id = cit.tag_id
          WHERE cit.catalog_item_id = $1 AND ct.kind = 'genre'`,
        [source.catalog_item_id],
      );
      if (genres.rows.length) {
        await setCatalogItemTags(
          client,
          catalogItemId,
          await resolveTags(client, targetGroupId, "genre", genres.rows.map((row) => row.label)),
        );
      }
    }
    await client.query(
      `INSERT INTO challenge_items
        (id,challenge_id,entry_type_id,catalog_item_id,semantic_key,title,description,position,
         metadata,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now(),now())`,
      [publicId(), targetId,
        source.entry_type_id ? typeMap.get(source.entry_type_id) : null, catalogItemId,
        source.semantic_key, source.title, source.description,
        source.position, JSON.stringify(source.metadata ?? {})],
    );
  }

  const metrics = await client.query<MetricRow>(
    `SELECT id,challenge_id,entry_type_id,field_id,semantic_key,label,operation,group_by,
            decimal_places,visible_during_challenge,position,settings
       FROM challenge_metrics WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY position`, [sourceChallengeId]);
  for (const source of metrics.rows) {
    await client.query(
      `INSERT INTO challenge_metrics
        (id,challenge_id,entry_type_id,field_id,semantic_key,label,operation,group_by,
         decimal_places,visible_during_challenge,position,settings,created_by_user_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,now(),now())`,
      [publicId(), targetId, typeMap.get(source.entry_type_id), source.field_id ? fieldMap.get(source.field_id) : null,
        source.semantic_key, source.label, source.operation, source.group_by, source.decimal_places,
        source.visible_during_challenge, source.position, JSON.stringify(source.settings ?? {}), createdByUserId],
    );
  }

  return targetId;
}
