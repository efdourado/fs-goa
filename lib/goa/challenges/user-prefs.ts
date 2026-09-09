import type { SessionContext } from "../../auth";
import { inTransaction } from "../../db";
import { ApiError } from "../../http";
import { challengeAccess } from "../domain/access";

/**
 * Per-viewer homepage organisation (`challenge_user_prefs`): a pin, a colour
 * tag and a manual sort position. Private to the caller — no audit, no admin
 * gate; anyone who can see a challenge can organise it for themselves.
 */

const COLOR_TAGS = new Set(["green", "blue", "violet", "coral", "amber", "rose"]);

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

/**
 * Rewrite the caller's manual order. `ids` is the full challenge list in the
 * desired order; ids the viewer cannot see are ignored, the rest get
 * `sort_index` 0..n in the given order.
 */
export async function setChallengeOrder(session: SessionContext, body: Record<string, unknown>) {
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 100))]
    : null;
  if (!ids) throw new ApiError(400, "invalid_request", "Envie a ordem em `ids`.");
  if (ids.length > 500) throw new ApiError(400, "too_many", "Lista grande demais.");

  return inTransaction(async (client) => {
    const visible = await client.query<{ id: string }>(
      `SELECT c.id
         FROM challenges c
         JOIN groups g ON g.id = c.group_id AND g.deleted_at IS NULL AND g.archived_at IS NULL
         JOIN group_members gm ON gm.group_id = c.group_id AND gm.user_id = $1 AND gm.removed_at IS NULL
        WHERE c.id = ANY($2::text[]) AND c.deleted_at IS NULL
          AND (g.kind = 'standard' OR (g.kind = 'personal' AND g.owner_user_id = $1))
          AND (c.status <> 'draft' OR gm.role IN ('owner','admin'))`,
      [session.user.id, ids],
    );
    const allowed = new Set(visible.rows.map((row) => row.id));
    const ordered = ids.filter((id) => allowed.has(id));
    if (ordered.length) {
      await client.query(
        `INSERT INTO challenge_user_prefs (user_id, challenge_id, sort_index, updated_at)
         SELECT $1, id, (ord - 1)::int, now()
           FROM unnest($2::text[]) WITH ORDINALITY AS t(id, ord)
         ON CONFLICT (user_id, challenge_id) DO UPDATE SET
           sort_index = EXCLUDED.sort_index, updated_at = now()`,
        [session.user.id, ordered],
      );
    }
    return { ordered };
  });
}
