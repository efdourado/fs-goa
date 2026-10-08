import type { SessionContext } from "../../auth";
import { inTransaction } from "../../db";
import { ApiError } from "../../http";
import { challengeAccess } from "../domain/access";

/**
 * Per-viewer homepage organisation (`challenge_user_prefs`): a pin and a
 * colour tag. Private to the caller — no audit, no admin
 * gate; anyone who can see a challenge can organise it for themselves.
 */

const COLOR_TAGS = new Set(["green", "blue", "violet", "amber"]);

/** Toggle the pin and/or set the colour tag for one challenge. */
export async function setChallengePref(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  const hasPinned = Object.hasOwn(body, "pinned");
  const hasColor = Object.hasOwn(body, "colorTag");
  if (!hasPinned && !hasColor) {
    throw new ApiError(400, "invalid_request", "Nada para atualizar.");
  }
  if (hasPinned && typeof body.pinned !== "boolean") {
    throw new ApiError(400, "invalid_request", "`pinned` deve ser booleano.");
  }
  let colorTag: string | null | undefined;
  if (hasColor) {
    if (body.colorTag === null) {
      colorTag = null;
    } else if (typeof body.colorTag === "string" && COLOR_TAGS.has(body.colorTag)) {
      colorTag = body.colorTag;
    } else {
      throw new ApiError(400, "invalid_request", "Cor inválida.");
    }
  }

  return inTransaction(async (client) => {
    // 404s if the viewer cannot see this challenge (same rule as the bootstrap).
    await challengeAccess(session.user.id, challengeId, client);
    const pinned = hasPinned ? (body.pinned as boolean) : null;
    await client.query(
      `INSERT INTO challenge_user_prefs (user_id, challenge_id, pinned, color_tag, updated_at)
       VALUES ($1, $2, COALESCE($3::boolean, false), $4, now())
       ON CONFLICT (user_id, challenge_id) DO UPDATE SET
         pinned = COALESCE($3::boolean, challenge_user_prefs.pinned),
         color_tag = CASE WHEN $5::boolean THEN $4 ELSE challenge_user_prefs.color_tag END,
         updated_at = now()`,
      [session.user.id, challengeId, pinned, colorTag ?? null, hasColor],
    );
    return { challengeId, ...(hasPinned ? { pinned: body.pinned } : {}), ...(hasColor ? { colorTag: colorTag ?? null } : {}) };
  });
}

