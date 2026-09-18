import type { PoolClient } from "pg";

import { oneOrNull } from "../../db";
import { ApiError } from "../../http";
import { assertRecommendationsAllowed, assertRecommenderInGroup } from "../catalog";

export interface ItemRecommender {
  userId: string | null;
  externalId: string | null;
  note: string | null;
}

export const NO_ITEM_RECOMMENDER: ItemRecommender = { userId: null, externalId: null, note: null };

/**
 * Reads "who brought this in" off a request: a group member (`recommendedByUserId`),
 * a saved outside name (`recommendedByExternalId`), or a free-text note
 * (`originNote`) — at most one, never a made-up participant. Setting any of them
 * needs the group to have recommendations on. `memberIds` skips a per-item
 * membership lookup when the caller already has the group's members loaded.
 */
export async function resolveItemRecommender(
  client: PoolClient,
  groupId: string,
  raw: Record<string, unknown>,
  memberIds?: Set<string>,
): Promise<ItemRecommender> {
  const user = typeof raw.recommendedByUserId === "string" ? raw.recommendedByUserId : "";
  const external = typeof raw.recommendedByExternalId === "string" ? raw.recommendedByExternalId : "";
  const note = typeof raw.originNote === "string" ? raw.originNote.trim().slice(0, 200) : "";
  if ([user, external, note].filter(Boolean).length > 1) {
    throw new ApiError(400, "invalid_recommender", "Escolha apenas uma origem: um membro, um nome salvo ou uma nota — não mais de uma.");
  }
  if (!user && !external && !note) return NO_ITEM_RECOMMENDER;
  await assertRecommendationsAllowed(client, groupId);
  if (user) {
    const isMember = memberIds
      ? memberIds.has(user)
      : Boolean(await oneOrNull<{ user_id: string }>(
          client,
          `SELECT gm.user_id FROM group_members gm JOIN groups g ON g.id = gm.group_id
            WHERE gm.group_id = $1 AND gm.user_id = $2 AND gm.removed_at IS NULL
              AND (g.kind = 'standard' OR gm.user_id = g.owner_user_id)`,
          [groupId, user],
        ));
    if (!isMember) throw new ApiError(400, "invalid_recommender", "Quem indicou precisa ser um membro do grupo.");
    return { userId: user, externalId: null, note: null };
  }
  if (external) {
    await assertRecommenderInGroup(client, external, groupId);
    return { userId: null, externalId: external, note: null };
  }
  return { userId: null, externalId: null, note };
}
