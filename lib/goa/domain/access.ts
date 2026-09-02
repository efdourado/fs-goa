import type { PoolClient } from "pg";
import type { GroupRole } from "../../auth";
import { oneOrNull, withClient } from "../../db";
import { ApiError } from "../../http";

export type ChallengeStatus = "draft" | "active" | "closed";

interface ChallengeAccessRow {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  rules: string | null;
  rule_sections: unknown;
  start_date: string | null;
  end_date: string | null;
  recipe_key: string | null;
  results_anon: boolean;
  time_zone: string;
  status: ChallengeStatus;
  role: GroupRole;
  is_participant: boolean;
  results_published_at: Date | null;
}

export interface ChallengeAccess {
  challenge: ChallengeAccessRow;
  canManage: boolean;
}

export async function challengeAccess(
  userId: string,
  challengeId: string,
  client?: PoolClient,
  lock = false,
): Promise<ChallengeAccess> {
  const work = async (activeClient: PoolClient) => {
    const challenge = await oneOrNull<ChallengeAccessRow>(
      activeClient,
      `SELECT c.id, c.group_id, c.title, c.description, c.rules, c.rule_sections,
              c.start_date::text AS start_date, c.end_date::text AS end_date, c.recipe_key, c.results_anon,
              c.time_zone, c.status, gm.role,
              EXISTS (
                SELECT 1 FROM challenge_participants cp
                 WHERE cp.challenge_id = c.id AND cp.user_id = $2 AND cp.removed_at IS NULL
              ) AS is_participant,
              c.results_published_at
         FROM challenges c
         JOIN groups g ON g.id = c.group_id AND g.deleted_at IS NULL AND g.archived_at IS NULL
         JOIN group_members gm ON gm.group_id = c.group_id
          AND gm.user_id = $2 AND gm.removed_at IS NULL
        WHERE c.id = $1 AND c.deleted_at IS NULL
          AND (g.kind = 'standard' OR (g.kind = 'personal' AND g.owner_user_id = $2))
          AND (c.status <> 'draft' OR gm.role IN ('owner','admin'))${lock ? " FOR UPDATE OF c" : ""}`,
      [challengeId, userId],
    );
    if (!challenge) throw new ApiError(404, "not_found", "Desafio não encontrado.");
    return {
      challenge,
      canManage: challenge.role === "owner" || challenge.role === "admin",
    };
  };
  return client ? work(client) : withClient(work);
}
