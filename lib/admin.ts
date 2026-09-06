import { type SessionContext } from "./auth";
import { inTransaction, withClient } from "./db";
import { redactForPlatformAdmin } from "./goa/domain/audit";
import { ApiError, stringValue } from "./http";

/**
 * Platform-admin console services. Deliberately metadata-only: counts, sizes,
 * timestamps and aggregate audit rows — never group or challenge *content*, and
 * never the power to delete a third party's content (ROADMAP §14). There is no
 * global bin here: a binned object is the owner's to restore or destroy.
 */

export async function adminOverview() {
  return withClient(async (client) => {
    const totals = await client.query<{
      users_total: number;
      users_new_week: number;
      users_disabled: number;
      groups_active: number;
      groups_trashed: number;
      challenges_active: number;
      challenges_trashed: number;
      entries_active: number;
      entries_trashed: number;
      audit_events: number;
      db_bytes: string;
    }>(
      `SELECT
        (SELECT count(*)::int FROM users) AS users_total,
        (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days') AS users_new_week,
        (SELECT count(*)::int FROM users WHERE disabled_at IS NOT NULL) AS users_disabled,
        (SELECT count(*)::int FROM groups WHERE kind = 'standard' AND deleted_at IS NULL AND archived_at IS NULL) AS groups_active,
        (SELECT count(*)::int FROM trash_items WHERE entity_kind = 'group') AS groups_trashed,
        (SELECT count(*)::int FROM challenges WHERE deleted_at IS NULL) AS challenges_active,
        (SELECT count(*)::int FROM trash_items WHERE entity_kind = 'challenge') AS challenges_trashed,
        (SELECT count(*)::int FROM entries WHERE deleted_at IS NULL) AS entries_active,
        (SELECT count(*)::int FROM entries WHERE deleted_at IS NOT NULL) AS entries_trashed,
        (SELECT count(*)::int FROM audit_events) AS audit_events,
        pg_database_size(current_database())::bigint::text AS db_bytes`,
    );
    const tables = await client.query<{ name: string; bytes: string }>(
      `SELECT c.relname AS name, pg_total_relation_size(c.oid)::bigint::text AS bytes
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY pg_total_relation_size(c.oid) DESC
        LIMIT 12`,
    );
    const row = totals.rows[0];
    return {
      users: { total: row.users_total, newThisWeek: row.users_new_week, disabled: row.users_disabled },
      groups: { active: row.groups_active, trashed: row.groups_trashed },
      challenges: { active: row.challenges_active, trashed: row.challenges_trashed },
      entries: { active: row.entries_active, trashed: row.entries_trashed },
      auditEvents: row.audit_events,
      storage: {
        databaseBytes: Number(row.db_bytes),
        tables: tables.rows.map((table) => ({ name: table.name, bytes: Number(table.bytes) })),
      },
    };
  });
}

export async function adminUsers() {
  return withClient(async (client) => {
    const result = await client.query<{
      id: string;
      display_name: string;
      username: string;
      email: string | null;
      created_at: Date;
      disabled_at: Date | null;
      deactivated_at: Date | null;
      deleted_at: Date | null;
      platform_admin: boolean;
      last_seen_at: Date | null;
      groups_owned: number;
      active_sessions: number;
      pending_reset_expires_at: Date | null;
    }>(
      `SELECT u.id, u.display_name, u.username, u.email, u.created_at, u.disabled_at, u.deactivated_at, u.deleted_at, u.platform_admin,
              (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at,
              (SELECT count(*)::int FROM groups g
                WHERE g.owner_user_id = u.id AND g.kind = 'standard' AND g.deleted_at IS NULL) AS groups_owned,
              (SELECT count(*)::int FROM sessions s
                WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS active_sessions,
              (SELECT max(prt.expires_at) FROM password_reset_tokens prt
                WHERE prt.user_id = u.id AND prt.used_at IS NULL AND prt.expires_at > now())
                AS pending_reset_expires_at
         FROM users u
        ORDER BY u.created_at DESC
        LIMIT 200`,
    );
    return {
      users: result.rows.map((user) => ({
        id: user.id,
        name: user.display_name,
        username: user.username,
        email: user.email,
        createdAt: user.created_at.toISOString(),
        disabledAt: user.disabled_at ? user.disabled_at.toISOString() : null,
        deactivatedAt: user.deactivated_at ? user.deactivated_at.toISOString() : null,
        deletedAt: user.deleted_at ? user.deleted_at.toISOString() : null,
        platformAdmin: user.platform_admin,
        lastSeenAt: user.last_seen_at ? user.last_seen_at.toISOString() : null,
        groupsOwned: user.groups_owned,
        activeSessions: user.active_sessions,
        pendingReset: user.pending_reset_expires_at
          ? { expiresAt: user.pending_reset_expires_at.toISOString() }
          : null,
      })),
    };
  });
}

/*
 * There is deliberately **no** admin-issued password-reset link.
 *
 * Any "the user must have asked first" guard is circular: the admin sees the
 * e-mail in this very console, can call the public `/api/auth/forgot` with it,
 * and so manufacture the request they were supposed to be fulfilling. Handing
 * them the raw token after that is account takeover, which would flatly
 * contradict ROADMAP §14 ("o administrador não deve acessar conteúdo privado").
 *
 * Until a delivery channel exists (e-mail is out of scope for V1, §1), recovery
 * is an **operator** action, not a product one: `node scripts/reset-password.mjs`
 * needs `DATABASE_URL`, which holding the `platform_admin` flag does not grant.
 */

export async function adminAudit(query: URLSearchParams) {
  const groupId = query.get("groupId");
  const entityId = query.get("entityId");
  const limitRaw = Number(query.get("limit") ?? 100);
  const limit = Number.isSafeInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;
  return withClient(async (client) => {
    const result = await client.query<{
      id: string;
      action: string;
      entity_type: string;
      entity_id: string;
      created_at: Date;
      actor: string | null;
      group_id: string;
      challenge_id: string | null;
      before: unknown;
      after: unknown;
      metadata: unknown;
    }>(
      // Personal-workspace audit rows carry private titles/comments/rules in
      // `before`/`after`/`metadata` — the platform admin sees that *something*
      // happened (actor, action, when) but never the content (ROADMAP §14).
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.created_at,
              u.username AS actor, a.group_id, a.challenge_id, a.before, a.after, a.metadata,
              (g.kind = 'personal') AS personal_scope
         FROM audit_events a
         LEFT JOIN users u ON u.id = a.actor_user_id
         JOIN groups g ON g.id = a.group_id
        WHERE ($1::text IS NULL OR a.group_id = $1)
          AND ($2::text IS NULL OR a.entity_id = $2)
        ORDER BY a.created_at DESC
        LIMIT $3`,
      [groupId, entityId, limit],
    );
    return {
      events: result.rows.map((event) => {
        const personal = (event as { personal_scope?: boolean }).personal_scope === true;
        return {
          id: event.id,
          action: event.action,
          entityType: event.entity_type,
          entityId: personal ? null : event.entity_id,
          createdAt: event.created_at.toISOString(),
          actor: event.actor,
          groupId: personal ? null : event.group_id,
          challengeId: personal ? null : event.challenge_id,
          personalScope: personal,
          before: personal ? null : redactForPlatformAdmin(event.before ?? null),
          after: personal ? null : redactForPlatformAdmin(event.after ?? null),
          metadata: personal ? {} : redactForPlatformAdmin(event.metadata ?? {}),
        };
      }),
    };
  });
}

/**
 * Operational breadcrumbs for irreversible actions (permanent deletes, account
 * removal). Already content-free by construction — the id is only a hash — so
 * support can correlate a report without ever seeing private data (ROADMAP §14).
 */
export async function adminSystemAudit(query: URLSearchParams) {
  const limitRaw = Number(query.get("limit") ?? 100);
  const limit = Number.isSafeInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;
  return withClient(async (client) => {
    const result = await client.query<{
      id: string; action: string; entity_kind: string; entity_id_hash: string;
      counts: unknown; created_at: Date; actor: string | null;
    }>(
      `SELECT s.id, s.action, s.entity_kind, s.entity_id_hash, s.counts, s.created_at, u.username AS actor
         FROM system_audit_events s LEFT JOIN users u ON u.id = s.actor_user_id
        ORDER BY s.created_at DESC LIMIT $1`,
      [limit],
    );
    return {
      events: result.rows.map((event) => ({
        id: event.id,
        action: event.action,
        entityKind: event.entity_kind,
        entityIdHash: event.entity_id_hash,
        counts: event.counts ?? {},
        actor: event.actor,
        createdAt: event.created_at.toISOString(),
      })),
    };
  });
}

export async function setUserDisabled(session: SessionContext, body: Record<string, unknown>) {
  const userId = stringValue(body, "userId", { min: 1, max: 100 })!;
  const disabled = body.disabled === true;
  if (userId === session.user.id) {
    throw new ApiError(400, "self_target", "Você não pode desativar a própria conta.");
  }
  return inTransaction(async (client) => {
    const target = await client.query<{ platform_admin: boolean }>(
      "SELECT platform_admin FROM users WHERE id = $1 FOR UPDATE",
      [userId],
    );
    if (!target.rowCount) throw new ApiError(404, "not_found", "Conta não encontrada.");
    if (target.rows[0].platform_admin) {
      throw new ApiError(400, "admin_target", "Contas de administração não podem ser desativadas pelo painel.");
    }
    await client.query(
      `UPDATE users SET disabled_at = ${disabled ? "now()" : "NULL"}, updated_at = now() WHERE id = $1`,
      [userId],
    );
    let revoked = 0;
    if (disabled) {
      const result = await client.query(
        `UPDATE sessions SET revoked_at = now(), revoke_reason = 'admin_disable'
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      revoked = result.rowCount ?? 0;
    }
    return { userId, disabled, sessionsRevoked: revoked };
  });
}

export async function revokeUserSessions(session: SessionContext, body: Record<string, unknown>) {
  const userId = stringValue(body, "userId", { min: 1, max: 100 })!;
  return withClient(async (client) => {
    const result = await client.query(
      `UPDATE sessions SET revoked_at = now(), revoke_reason = 'admin_revoke'
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    console.warn("admin.revokeSessions", { actor: session.user.username, userId, count: result.rowCount ?? 0 });
    return { userId, sessionsRevoked: result.rowCount ?? 0 };
  });
}

export async function setUserPlatformAdmin(session: SessionContext, body: Record<string, unknown>) {
  const userId = stringValue(body, "userId", { min: 1, max: 100 })!;
  const platformAdmin = body.platformAdmin === true;
  if (userId === session.user.id) {
    throw new ApiError(400, "self_target", "Você não pode mudar o próprio acesso de administração.");
  }
  return inTransaction(async (client) => {
    const target = await client.query<{ disabled_at: Date | null }>(
      "SELECT disabled_at FROM users WHERE id = $1 FOR UPDATE",
      [userId],
    );
    if (!target.rowCount) throw new ApiError(404, "not_found", "Conta não encontrada.");
    if (platformAdmin && target.rows[0].disabled_at) {
      throw new ApiError(400, "disabled_target", "Reative a conta antes de torná-la administradora.");
    }
    await client.query(
      "UPDATE users SET platform_admin = $2, updated_at = now() WHERE id = $1",
      [userId, platformAdmin],
    );
    console.warn("admin.setPlatformAdmin", { actor: session.user.username, userId, platformAdmin });
    return { userId, platformAdmin };
  });
}
