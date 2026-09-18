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
      groups_used_30d: number;
      groups_trashed: number;
      challenges_active: number;
      challenges_in_progress: number;
      challenges_used_30d: number;
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
        (SELECT count(*)::int FROM challenges WHERE deleted_at IS NULL AND status = 'active') AS challenges_in_progress,
        (SELECT count(DISTINCT e.challenge_id)::int FROM entries e JOIN challenges c ON c.id = e.challenge_id
          WHERE e.deleted_at IS NULL AND c.deleted_at IS NULL AND e.created_at > now() - interval '30 days') AS challenges_used_30d,
        (SELECT count(DISTINCT c.group_id)::int FROM entries e JOIN challenges c ON c.id = e.challenge_id
           JOIN groups g ON g.id = c.group_id AND g.kind = 'standard'
          WHERE e.deleted_at IS NULL AND c.deleted_at IS NULL AND e.created_at > now() - interval '30 days') AS groups_used_30d,
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
      // `active` keeps its old key for compatibility but means "not deleted":
      // a challenge can be a draft, closed, or untouched for months. The
      // console labels it "Desafios" and shows the two stricter counts next to it.
      groups: { active: row.groups_active, activeLast30Days: row.groups_used_30d, trashed: row.groups_trashed },
      challenges: {
        active: row.challenges_active,
        inProgress: row.challenges_in_progress,
        usedLast30Days: row.challenges_used_30d,
        trashed: row.challenges_trashed,
      },
      entries: { active: row.entries_active, trashed: row.entries_trashed },
      auditEvents: row.audit_events,
      storage: {
        databaseBytes: Number(row.db_bytes),
        tables: tables.rows.map((table) => ({ name: table.name, bytes: Number(table.bytes) })),
      },
    };
  });
}

/**
 * Aggregate product insights: are people reaching a useful outcome? Counts and
 * medians only — never a title, name, score, comment or any field value.
 *
 * Every figure comes from a *server-confirmed* row (an `audit_events` row is
 * written in the same transaction as the change it records; entries and
 * challenges are persisted rows). Failed or abandoned attempts are not logged,
 * so a low number means fewer completed actions, not necessarily fewer tries.
 * Platform-admin accounts — which also run seeds, demos and manual tests — are
 * excluded unless `includeStaff` is set.
 */
export async function adminInsights(params: URLSearchParams) {
  const days = Math.min(365, Math.max(7, Number.parseInt(params.get("days") ?? "30", 10) || 30));
  const includeStaff = params.get("includeStaff") === "1";
  // $1 = window in days, $2 = include platform-admin accounts.
  const notStaff = (userIdColumn: string, staffParam = 2) =>
    `($${staffParam}::boolean OR NOT EXISTS (SELECT 1 FROM users su WHERE su.id = ${userIdColumn} AND su.platform_admin))`;
  const since = "now() - make_interval(days => $1::int)";
  const args = [days, includeStaff];

  return withClient(async (client) => {
    const one = async <T extends Record<string, unknown>>(sql: string, values: unknown[] = args) =>
      (await client.query<T>(sql, values)).rows[0];

    const overview = await one<{
      challenges_total: number; challenges_in_progress: number; challenges_used: number;
      groups_total: number; groups_used: number; accounts_new: number; accounts_with_entry: number;
    }>(`SELECT
        (SELECT count(*)::int FROM challenges c WHERE c.deleted_at IS NULL AND ${notStaff("c.created_by_user_id")}) AS challenges_total,
        (SELECT count(*)::int FROM challenges c WHERE c.deleted_at IS NULL AND c.status = 'active' AND ${notStaff("c.created_by_user_id")}) AS challenges_in_progress,
        (SELECT count(DISTINCT e.challenge_id)::int FROM entries e JOIN challenges c ON c.id = e.challenge_id
          WHERE e.deleted_at IS NULL AND c.deleted_at IS NULL AND e.created_at > ${since} AND ${notStaff("e.created_by_user_id")}) AS challenges_used,
        (SELECT count(*)::int FROM groups g WHERE g.kind = 'standard' AND g.deleted_at IS NULL AND g.archived_at IS NULL AND ${notStaff("g.owner_user_id")}) AS groups_total,
        (SELECT count(DISTINCT c.group_id)::int FROM entries e JOIN challenges c ON c.id = e.challenge_id
           JOIN groups g ON g.id = c.group_id AND g.kind = 'standard'
          WHERE e.deleted_at IS NULL AND c.deleted_at IS NULL AND e.created_at > ${since} AND ${notStaff("e.created_by_user_id")}) AS groups_used,
        (SELECT count(*)::int FROM users u WHERE u.created_at > ${since} AND ($2::boolean OR NOT u.platform_admin)) AS accounts_new,
        (SELECT count(DISTINCT e.created_by_user_id)::int FROM entries e
          WHERE e.deleted_at IS NULL AND e.created_at > ${since} AND ${notStaff("e.created_by_user_id")}) AS accounts_with_entry`);

    const weekly = await client.query<{ week: string; accounts: number; created: number; entries: number }>(
      `WITH weeks AS (
         SELECT generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') AS w
       )
       SELECT to_char(w, 'YYYY-MM-DD') AS week,
         (SELECT count(*)::int FROM users u WHERE u.created_at >= w AND u.created_at < w + interval '1 week'
            AND ($1::boolean OR NOT u.platform_admin)) AS accounts,
         (SELECT count(*)::int FROM audit_events a WHERE a.action = 'challenge.created'
            AND a.created_at >= w AND a.created_at < w + interval '1 week' AND ${notStaff("a.actor_user_id", 1)}) AS created,
         (SELECT count(*)::int FROM entries e WHERE e.deleted_at IS NULL
            AND e.created_at >= w AND e.created_at < w + interval '1 week' AND ${notStaff("e.created_by_user_id", 1)}) AS entries
       FROM weeks ORDER BY w`,
      [includeStaff],
    );

    const audit = await one<{
      created: number; copied_template: number; copied_challenge: number; libraries: number;
      shared_types: number; recommenders: number; scheduled_items: number;
    }>(`SELECT
        count(*) FILTER (WHERE a.action = 'challenge.created')::int AS created,
        count(*) FILTER (WHERE a.action = 'challenge.duplicated' AND a.after->>'fromTemplate' = 'true')::int AS copied_template,
        count(*) FILTER (WHERE a.action = 'challenge.duplicated' AND coalesce(a.after->>'fromTemplate', 'false') <> 'true')::int AS copied_challenge,
        count(*) FILTER (WHERE a.action = 'catalog.library_created')::int AS libraries,
        count(*) FILTER (WHERE a.action = 'entry_type.created' AND a.after->>'answerScope' = 'shared')::int AS shared_types,
        count(*) FILTER (WHERE a.action = 'catalog.recommender_created')::int AS recommenders,
        count(*) FILTER (WHERE a.action = 'item.updated' AND jsonb_exists(a.after, 'schedulePrecision'))::int AS scheduled_items
       FROM audit_events a WHERE a.created_at > ${since} AND ${notStaff("a.actor_user_id")}`);

    const byRecipe = await client.query<{ recipe: string; count: number }>(
      `SELECT coalesce(c.recipe_key, 'sem modelo') AS recipe, count(*)::int AS count
         FROM challenges c WHERE c.created_at > ${since} AND ${notStaff("c.created_by_user_id")}
        GROUP BY 1 ORDER BY 2 DESC`,
      args,
    );

    const firstRecord = await one<{ cohort: number; with_first_entry: number; median_hours: number | null }>(
      `WITH cohort AS (
         SELECT c.created_at,
                (SELECT min(e.created_at) FROM entries e WHERE e.challenge_id = c.id AND e.deleted_at IS NULL) AS first_entry
           FROM challenges c WHERE c.created_at > ${since} AND ${notStaff("c.created_by_user_id")}
       )
       SELECT count(*)::int AS cohort, count(first_entry)::int AS with_first_entry,
              (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_entry - created_at) / 3600)
                 FILTER (WHERE first_entry IS NOT NULL))::float8 AS median_hours
         FROM cohort`,
    );

    const returning = await one<{ people: number; multi_day: number }>(
      `SELECT count(*)::int AS people, (count(*) FILTER (WHERE days >= 2))::int AS multi_day
         FROM (SELECT e.created_by_user_id, count(DISTINCT e.created_at::date) AS days
                 FROM entries e WHERE e.deleted_at IS NULL AND e.created_at > ${since} AND ${notStaff("e.created_by_user_id")}
                GROUP BY 1) t`,
    );

    const feedbackRows = await client.query<{ impact: string; count: number; not_working: number; ease_sum: number | null; ease_n: number }>(
      `SELECT impact, count(*)::int AS count,
              count(*) FILTER (WHERE succeeded IS FALSE)::int AS not_working,
              sum(ease)::int AS ease_sum, count(ease)::int AS ease_n
         FROM feedback f WHERE f.created_at > ${since} AND ${notStaff("f.user_id")}
        GROUP BY impact`,
      args,
    );
    const feedbackTotal = feedbackRows.rows.reduce((sum, row) => sum + row.count, 0);
    const easeN = feedbackRows.rows.reduce((sum, row) => sum + row.ease_n, 0);
    const easeSum = feedbackRows.rows.reduce((sum, row) => sum + (row.ease_sum ?? 0), 0);

    return {
      windowDays: days,
      includesStaff: includeStaff,
      definitions: {
        confirmed: "Cada número conta uma ação que o servidor confirmou (registros e desafios gravados; eventos de auditoria escritos junto com a mudança). Tentativas que falharam ou foram abandonadas não são registradas: um número baixo significa menos ações concluídas, não necessariamente menos tentativas.",
        staff: "Contas de administração da plataforma ficam de fora por padrão — elas também rodam seeds, demonstrações e testes manuais.",
        inProgress: "Desafio não excluído com status ativo. Um desafio não excluído pode ser rascunho, encerrado ou parado há meses.",
        usedRecently: "Desafio (ou grupo) com pelo menos um registro gravado dentro da janela.",
        created: "Desafios criados na janela, contando os que depois foram excluídos.",
        copied: "Desafios criados por cópia — de um modelo público ou de outro desafio — em vez de do zero.",
        firstRecord: "Dos desafios criados na janela, quantos já receberam o primeiro registro. Os mais recentes ainda podem estar esperando: leia junto com a mediana.",
        returnUsage: "Pessoas com registros em pelo menos dois dias diferentes dentro da janela.",
        customization: "Uso de recursos além do modelo padrão: bibliotecas criadas (inclui a Tables criada sozinha), respostas compartilhadas, nomes de indicadores externos salvos e itens com agenda.",
        feedback: "Feedbacks enviados na janela. Mostram atrito, não provam se as pessoas gostam do produto — isso continua pedindo conversa.",
        privacy: "Somente contagens e medianas estruturais. Nenhum título, nome, nota, comentário ou conteúdo de formulário entra aqui.",
      },
      overview: {
        challengesTotal: overview.challenges_total,
        challengesInProgress: overview.challenges_in_progress,
        challengesUsedInWindow: overview.challenges_used,
        groupsTotal: overview.groups_total,
        groupsUsedInWindow: overview.groups_used,
        accountsNewInWindow: overview.accounts_new,
        accountsWithEntryInWindow: overview.accounts_with_entry,
        weekly: weekly.rows.map((row) => ({ week: row.week, accountsCreated: row.accounts, challengesCreated: row.created, entriesRecorded: row.entries })),
      },
      creation: {
        challengesCreated: audit.created,
        copiedFromTemplate: audit.copied_template,
        copiedFromChallenge: audit.copied_challenge,
        byRecipe: byRecipe.rows.map((row) => ({ recipe: row.recipe, count: row.count })),
        customization: {
          librariesCreated: audit.libraries,
          sharedResponseTypesCreated: audit.shared_types,
          externalRecommendersSaved: audit.recommenders,
          itemsScheduled: audit.scheduled_items,
        },
        firstRecord: {
          challengesCreated: firstRecord.cohort,
          withFirstRecord: firstRecord.with_first_entry,
          medianHoursToFirstRecord: firstRecord.median_hours === null ? null : Number(firstRecord.median_hours.toFixed(1)),
        },
        returnUsage: { peopleWithRecords: returning.people, peopleOnMultipleDays: returning.multi_day },
      },
      problems: {
        feedbackCount: feedbackTotal,
        blocked: feedbackRows.rows.find((row) => row.impact === "blocked")?.count ?? 0,
        didNotWork: feedbackRows.rows.reduce((sum, row) => sum + row.not_working, 0),
        averageEase: easeN ? Number((easeSum / easeN).toFixed(1)) : null,
        byImpact: feedbackRows.rows.map((row) => ({ impact: row.impact, count: row.count })),
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
    }>(
      `SELECT u.id, u.display_name, u.username, u.email, u.created_at, u.disabled_at, u.deactivated_at, u.deleted_at, u.platform_admin,
              (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at,
              (SELECT count(*)::int FROM groups g
                WHERE g.owner_user_id = u.id AND g.kind = 'standard' AND g.deleted_at IS NULL) AS groups_owned,
              (SELECT count(*)::int FROM sessions s
                WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS active_sessions
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
      })),
    };
  });
}

/*
 * `/admin` has no password-reset control at all.
 *
 * An admin-issued link is account takeover: the admin sees the e-mail in this
 * very console and could manufacture any "the user asked first" proof, which
 * contradicts ROADMAP §14 ("o administrador não deve acessar conteúdo privado").
 * A self-service flow needs an e-mail channel to deliver the link, and that is
 * out of scope for V1 (§1). So the whole visible flow — the "forgot password"
 * screen, `/api/auth/forgot`, `/api/auth/reset` and the pending-request
 * indicator that used to live here — was withdrawn on 2026-09-06 until an
 * e-mail provider is wired up. The `password_reset_tokens` table stays, dormant.
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
