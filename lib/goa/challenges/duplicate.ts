import { type SessionContext, requireGroupRole } from "../../auth";
import { inTransaction } from "../../db";
import { challengeAccess, publicId, writeAudit } from "../../goa-domain";
import { ApiError, stringValue } from "../../http";
import type { FieldRow, MetricRow } from "./types";

export async function duplicateChallenge(
  session: SessionContext,
  sourceChallengeId: string,
  body: Record<string, unknown>,
) {
  return inTransaction(async (client) => {
    const sourceAccess = await challengeAccess(session.user.id, sourceChallengeId, client, true);
    await requireGroupRole(session.user.id, sourceAccess.challenge.group_id, ["owner", "admin"], client);
    if (typeof body.targetGroupId === "string" && body.targetGroupId !== sourceAccess.challenge.group_id) {
      throw new ApiError(400, "cross_group_copy_unavailable", "No MVP, a cópia permanece no grupo original.");
    }
    const title = stringValue(body, "title", { max: 160, optional: true }) ?? `Cópia de ${sourceAccess.challenge.title}`;
    const targetId = publicId();
    await client.query(
      `INSERT INTO challenges
        (id,group_id,created_by_user_id,title,description,rules,start_date,end_date,time_zone,status,created_at,updated_at)
       SELECT $1,group_id,$2,$3,description,rules,start_date,end_date,time_zone,'draft',now(),now()
         FROM challenges WHERE id=$4`,
      [targetId, session.user.id, title, sourceChallengeId],
    );

    const typeMap = new Map<string, string>();
    const sourceTypes = await client.query<{
      id: string; semantic_key: string; name: string; description: string | null; submission_mode: string;
    }>("SELECT id,semantic_key,name,description,submission_mode FROM entry_types WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY created_at", [sourceChallengeId]);
    for (const source of sourceTypes.rows) {
      const id = publicId();
      typeMap.set(source.id, id);
      await client.query(
        `INSERT INTO entry_types
          (id,challenge_id,semantic_key,name,description,submission_mode,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,now(),now())`,
        [id, targetId, source.semantic_key, source.name, source.description, source.submission_mode],
      );
    }

    const checkpointMap = new Map<string, string>();
    const checkpoints = await client.query<{
      id: string; semantic_key: string; title: string; description: string | null;
      position: number; starts_at: Date | null; due_at: Date | null;
    }>(
      `SELECT id,semantic_key,title,description,position,starts_at,due_at
         FROM challenge_checkpoints WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY position`, [sourceChallengeId]);
    for (const source of checkpoints.rows) {
      const id = publicId();
      checkpointMap.set(source.id, id);
      await client.query(
        `INSERT INTO challenge_checkpoints
          (id,challenge_id,semantic_key,title,description,position,starts_at,due_at,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),now())`,
        [id, targetId, source.semantic_key, source.title, source.description, source.position, source.starts_at, source.due_at],
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
      checkpoint_id: string | null; entry_type_id: string; semantic_key: string; title: string;
      description: string | null; position: number; opens_at: Date | null; due_at: Date | null; metadata: unknown;
    }>(
      `SELECT checkpoint_id,entry_type_id,semantic_key,title,description,position,opens_at,due_at,metadata
         FROM challenge_items WHERE challenge_id=$1 AND archived_at IS NULL ORDER BY position`, [sourceChallengeId]);
    for (const source of sourceItems.rows) {
      await client.query(
        `INSERT INTO challenge_items
          (id,challenge_id,checkpoint_id,entry_type_id,semantic_key,title,description,position,
           opens_at,due_at,metadata,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,now(),now())`,
        [publicId(), targetId, source.checkpoint_id ? checkpointMap.get(source.checkpoint_id) : null,
          typeMap.get(source.entry_type_id), source.semantic_key, source.title, source.description,
          source.position, source.opens_at, source.due_at, JSON.stringify(source.metadata ?? {})],
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
          source.visible_during_challenge, source.position, JSON.stringify(source.settings ?? {}), session.user.id],
      );
    }

    await client.query(
      `INSERT INTO challenge_duplications
        (group_id,source_challenge_id,target_challenge_id,copied_by_user_id,created_at)
       VALUES ($1,$2,$3,$4,now())`,
      [sourceAccess.challenge.group_id, sourceChallengeId, targetId, session.user.id],
    );
    await writeAudit(client, sourceAccess.challenge.group_id, targetId, session.user.id,
      "challenge.duplicated", "challenge", targetId, null, { sourceChallengeId });
    return { id: targetId, challengeId: targetId, status: "draft" };
  });
}
