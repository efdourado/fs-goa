import type { SessionContext } from "../../auth";
import { inTransaction } from "../../db";
import { ApiError } from "../../http";
import { challengeAccess } from "../domain/access";

/**
 * Per-viewer homepage organisation (`challenge_user_prefs`): a pin. Private to the caller — no audit, no admin
 * gate; anyone who can see a challenge can pin it for themselves.
 */
export async function setChallengePref(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  if (typeof body.pinned !== "boolean") {
    throw new ApiError(400, "invalid_request", "`pinned` deve ser booleano.");
  }
  const pinned = body.pinned;
  return inTransaction(async (client) => {
    // 404s if the viewer cannot see this challenge (same rule as the bootstrap).
    await challengeAccess(session.user.id, challengeId, client);
    await client.query(
      `INSERT INTO challenge_user_prefs (user_id, challenge_id, pinned, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id, challenge_id) DO UPDATE SET pinned = $3, updated_at = now()`,
      [session.user.id, challengeId, pinned],
    );
    return { challengeId, pinned };
  });
}
