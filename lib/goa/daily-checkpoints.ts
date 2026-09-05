import type { PoolClient } from "pg";

import { ApiError } from "../http";
import { publicId } from "./domain/shared";

interface DailyCheckpointInput {
  id: string;
  semantic_key: string;
  title: string;
  position: number;
  day: string;
}

function dailyCheckpointInputs(
  startsOn: string,
  endsOn: string,
  rangeMessage: string,
): DailyCheckpointInput[] {
  const current = new Date(`${startsOn}T00:00:00Z`);
  const last = new Date(`${endsOn}T00:00:00Z`);
  const inputs: DailyCheckpointInput[] = [];

  while (current <= last) {
    if (inputs.length >= 366) {
      throw new ApiError(400, "date_range", rangeMessage);
    }
    const position = inputs.length;
    inputs.push({
      id: publicId(),
      semantic_key: `dia_${position + 1}`,
      title: `Dia ${position + 1}`,
      position,
      day: current.toISOString().slice(0, 10),
    });
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return inputs;
}

/**
 * Sincroniza todos os checkpoints diários em duas idas ao PostgreSQL, preservando
 * os IDs e títulos personalizados de dias já existentes.
 */
export async function syncDailyCheckpoints(
  client: PoolClient,
  challengeId: string,
  startsOn: string,
  endsOn: string,
  rangeMessage = "Use no máximo 366 checkpoints.",
): Promise<string[]> {
  const inputs = dailyCheckpointInputs(startsOn, endsOn, rangeMessage);
  const upserted = await client.query<{ id: string; position: number }>(
    `WITH upserted AS (
       INSERT INTO challenge_checkpoints
         (id,challenge_id,semantic_key,title,kind,position,starts_at,due_at,created_at,updated_at)
       SELECT input.id,$1,input.semantic_key,input.title,'day',input.position,
              input.day::timestamp AT TIME ZONE 'America/Sao_Paulo',
              (input.day + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo',now(),now()
         FROM jsonb_to_recordset($2::jsonb) AS input(
           id text,semantic_key text,title text,position integer,day date
         )
       ON CONFLICT (challenge_id,semantic_key) DO UPDATE SET
         position=excluded.position,starts_at=excluded.starts_at,
         due_at=excluded.due_at,kind='day',archived_at=NULL,updated_at=now()
       RETURNING id,position
     )
     SELECT id,position FROM upserted ORDER BY position`,
    [challengeId, JSON.stringify(inputs)],
  );
  const ids = upserted.rows.map((row) => row.id);

  // Reagendar nunca descarta um dia que já recebeu check-in: arquivar só os
  // checkpoints fora da nova janela que continuam vazios. Encurtar um período
  // por cima de registros é barrado antes, em updateChallenge; esta cláusula é a
  // rede de segurança para os demais caminhos (ex.: regeneração manual).
  await client.query(
    `UPDATE challenge_checkpoints cc SET archived_at=now(),updated_at=now()
      WHERE cc.challenge_id=$1 AND cc.archived_at IS NULL AND NOT (cc.id=ANY($2::text[]))
        AND NOT EXISTS (
          SELECT 1 FROM entries e
           WHERE e.challenge_id=cc.challenge_id AND e.deleted_at IS NULL
             AND e.occurred_on=(cc.starts_at AT TIME ZONE 'America/Sao_Paulo')::date
        )`,
    [challengeId, ids],
  );
  return ids;
}
