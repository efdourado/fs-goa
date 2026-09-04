import type { PoolClient } from "pg";
import { inTransaction, oneOrNull, withClient } from "./db";
import { ApiError, cookieValue, requireMutationOrigin } from "./http";
import {
  clearSessionCookie,
  deriveCsrfToken,
  generateOpaqueToken,
  hashPassword,
  hashToken,
  normalizeUsername,
  serializeSessionCookie,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  SESSION_COOKIE_NAME,
  verifyCsrfToken,
  verifyPassword,
} from "./security";

export type GroupRole = "owner" | "admin" | "participant";

export interface AuthenticatedUser {
  id: string;
  name: string;
  username: string;
  email: string | null;
  platformAdmin: boolean;
}

export interface SessionContext {
  id: string;
  rawToken: string;
  user: AuthenticatedUser;
}

interface UserRow {
  id: string;
  display_name: string;
  username: string;
  email: string | null;
  password_hash: string;
  platform_admin: boolean;
}

interface SessionRow extends UserRow {
  session_id: string;
}

const DUMMY_PASSWORD_HASH =
  "PBKDF2-SHA256$v=1$i=600000$l=32$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SESSION_LIFETIME_MS = SESSION_COOKIE_MAX_AGE_SECONDS * 1_000;
const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const LOGIN_MAX_FAILURES = 10;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1_000;
const PASSWORD_RESET_MIN_INTERVAL_MS = 60 * 1_000;

/** Login accepts a username or an e-mail — resolve which, and how to normalize it. */
function resolveIdentifier(raw: unknown): { column: "username_normalized" | "email_normalized"; value: string } {
  if (typeof raw === "string" && raw.includes("@")) {
    const { normalized } = normalizeEmail(raw);
    if (normalized) return { column: "email_normalized", value: normalized };
  }
  try {
    return { column: "username_normalized", value: normalizeUsername(raw) };
  } catch {
    return { column: "username_normalized", value: "invalid_login" };
  }
}

function publicUser(row: UserRow): AuthenticatedUser {
  return {
    id: row.id,
    name: row.display_name,
    username: row.username,
    email: row.email,
    platformAdmin: row.platform_admin === true,
  };
}

function normalizeEmail(value: unknown): { email: string | null; normalized: string | null } {
  if (value === undefined || value === null || value === "") return { email: null, normalized: null };
  if (typeof value !== "string" || value.length > 254) {
    throw new ApiError(400, "invalid_email", "E-mail inválido.");
  }
  const email = value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new ApiError(400, "invalid_email", "E-mail inválido.");
  }
  return { email, normalized: email.normalize("NFKC").toLowerCase() };
}

function displayName(value: unknown): string {
  if (typeof value !== "string") throw new ApiError(400, "invalid_name", "Informe seu nome.");
  const name = value.trim();
  if (Array.from(name).length < 2 || Array.from(name).length > 80) {
    throw new ApiError(400, "invalid_name", "O nome precisa ter entre 2 e 80 caracteres.");
  }
  return name;
}

async function createSession(client: PoolClient, userId: string): Promise<{ rawToken: string; id: string }> {
  const rawToken = generateOpaqueToken();
  const tokenHash = await hashToken(rawToken);
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
  await client.query(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
     VALUES ($1, $2, $3, now(), $4, now())`,
    [id, userId, tokenHash, expiresAt],
  );
  return { rawToken, id };
}

export async function registerAccount(body: Record<string, unknown>): Promise<{
  user: AuthenticatedUser;
  csrfToken: string;
  setCookie: string;
}> {
  let usernameNormalized: string;
  try {
    usernameNormalized = normalizeUsername(body.username);
  } catch {
    throw new ApiError(400, "invalid_username", "Use de 3 a 32 letras minúsculas, números, ponto, hífen ou sublinhado.");
  }
  const name = displayName(body.name);
  const username = usernameNormalized;
  const email = normalizeEmail(body.email);

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(body.password);
  } catch {
    throw new ApiError(400, "invalid_password", "A senha precisa ter ao menos 10 caracteres.");
  }

  try {
    return await inTransaction(async (client) => {
      const userId = crypto.randomUUID();
      const inserted = await oneOrNull<UserRow>(
        client,
        `INSERT INTO users
          (id, display_name, username, username_normalized, email, email_normalized, password_hash,
           password_changed_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now(), now())
         RETURNING id, display_name, username, email, password_hash, platform_admin`,
        [userId, name, username, usernameNormalized, email.email, email.normalized, passwordHash],
      );
      if (!inserted) throw new Error("User insert did not return a row.");
      const session = await createSession(client, userId);
      return {
        user: publicUser(inserted),
        csrfToken: await deriveCsrfToken(session.rawToken),
        setCookie: serializeSessionCookie(session.rawToken),
      };
    });
  } catch (error) {
    const violation = error as { code?: string; constraint?: string };
    if (violation.code === "23505") {
      if (violation.constraint === "users_email_normalized_uidx") {
        throw new ApiError(409, "email_taken", "Esse e-mail já está em uso.");
      }
      throw new ApiError(409, "username_taken", "Esse nome de usuário já está em uso.");
    }
    throw error;
  }
}

async function loginAllowed(client: PoolClient, username: string): Promise<boolean> {
  const row = await oneOrNull<{ failure_count: number; window_started_at: Date; locked_until: Date | null }>(
    client,
    `SELECT failure_count, window_started_at, locked_until
       FROM login_attempts WHERE username_normalized = $1`,
    [username],
  );
  return !row?.locked_until || row.locked_until.getTime() <= Date.now();
}

async function recordLoginFailure(client: PoolClient, username: string): Promise<void> {
  await client.query(
    `INSERT INTO login_attempts (username_normalized, window_started_at, failure_count, locked_until)
     VALUES ($1, now(), 1, NULL)
     ON CONFLICT (username_normalized) DO UPDATE SET
       failure_count = CASE
         WHEN login_attempts.window_started_at < now() - interval '15 minutes' THEN 1
         ELSE login_attempts.failure_count + 1 END,
       window_started_at = CASE
         WHEN login_attempts.window_started_at < now() - interval '15 minutes' THEN now()
         ELSE login_attempts.window_started_at END,
       locked_until = CASE
         WHEN login_attempts.window_started_at >= now() - interval '15 minutes'
          AND login_attempts.failure_count + 1 >= $2
         THEN now() + interval '15 minutes' ELSE NULL END`,
    [username, LOGIN_MAX_FAILURES],
  );
}

export async function loginAccount(body: Record<string, unknown>): Promise<{
  user: AuthenticatedUser;
  csrfToken: string;
  setCookie: string;
}> {
  const identifier = resolveIdentifier(body.username);
  const password = body.password;

  return inTransaction(async (client) => {
    if (!(await loginAllowed(client, identifier.value))) {
      throw new ApiError(429, "login_limited", "Muitas tentativas. Aguarde 15 minutos.");
    }
    const row = await oneOrNull<UserRow>(
      client,
      `SELECT id, display_name, username, email, password_hash, platform_admin
         FROM users WHERE ${identifier.column} = $1 AND disabled_at IS NULL`,
      [identifier.value],
    );
    const matches = await verifyPassword(password, row?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!row || !matches) {
      await recordLoginFailure(client, identifier.value);
      throw new ApiError(401, "invalid_credentials", "Usuário ou senha incorretos.");
    }

    await client.query("DELETE FROM login_attempts WHERE username_normalized = $1", [identifier.value]);
    const session = await createSession(client, row.id);
    return {
      user: publicUser(row),
      csrfToken: await deriveCsrfToken(session.rawToken),
      setCookie: serializeSessionCookie(session.rawToken),
    };
  });
}

/**
 * Invalidates any pending reset token for the user and mints a fresh one.
 * Only the hash is stored — the returned raw token lives only in the reset link.
 */
export async function mintResetToken(
  client: PoolClient,
  userId: string,
  options: { throttle?: boolean } = {},
): Promise<{ rawToken: string; expiresAt: Date }> {
  if (options.throttle !== false) {
    const recent = await oneOrNull<{ created_at: Date }>(
      client,
      `SELECT created_at FROM password_reset_tokens
        WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    if (recent && Date.now() - recent.created_at.getTime() < PASSWORD_RESET_MIN_INTERVAL_MS) {
      throw new ApiError(429, "reset_throttled", "Aguarde um minuto antes de pedir outro link.");
    }
  }
  await client.query(
    "UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
    [userId],
  );
  const rawToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  await client.query(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, created_at, expires_at)
     VALUES ($1, $2, $3, now(), $4)`,
    [crypto.randomUUID(), userId, await hashToken(rawToken), expiresAt],
  );
  return { rawToken, expiresAt };
}

/** Records that a user wants to reset. Always resolves — never leaks existence. */
export async function requestPasswordReset(body: Record<string, unknown>): Promise<{ ok: true }> {
  const { normalized } = normalizeEmail(body.email);
  if (normalized) {
    await inTransaction(async (client) => {
      const user = await oneOrNull<{ id: string }>(
        client,
        "SELECT id FROM users WHERE email_normalized = $1 AND disabled_at IS NULL",
        [normalized],
      );
      if (user) {
        try {
          await mintResetToken(client, user.id);
        } catch (error) {
          if (!(error instanceof ApiError && error.code === "reset_throttled")) throw error;
        }
      }
    });
  }
  return { ok: true };
}

export async function resetPassword(body: Record<string, unknown>): Promise<{
  user: AuthenticatedUser;
  csrfToken: string;
  setCookie: string;
}> {
  const token = typeof body.token === "string" ? body.token : "";
  let tokenHash: string;
  try {
    tokenHash = await hashToken(token);
  } catch {
    throw new ApiError(400, "invalid_reset_token", "Link de redefinição inválido ou expirado.");
  }
  let passwordHash: string;
  try {
    passwordHash = await hashPassword(body.password);
  } catch {
    throw new ApiError(400, "invalid_password", "A senha precisa ter ao menos 10 caracteres.");
  }

  return inTransaction(async (client) => {
    const row = await oneOrNull<{ id: string; user_id: string }>(
      client,
      `SELECT id, user_id FROM password_reset_tokens
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        FOR UPDATE`,
      [tokenHash],
    );
    if (!row) throw new ApiError(400, "invalid_reset_token", "Link de redefinição inválido ou expirado.");

    await client.query(
      "UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1",
      [row.user_id, passwordHash],
    );
    await client.query("UPDATE password_reset_tokens SET used_at = now() WHERE id = $1", [row.id]);
    await client.query(
      "UPDATE sessions SET revoked_at = now(), revoke_reason = 'password_reset' WHERE user_id = $1 AND revoked_at IS NULL",
      [row.user_id],
    );
    const account = await oneOrNull<UserRow>(
      client,
      `SELECT id, display_name, username, email, password_hash, platform_admin
         FROM users WHERE id = $1`,
      [row.user_id],
    );
    if (!account) throw new Error("User row vanished during password reset.");
    console.warn("auth.reset", { userId: row.user_id });
    const session = await createSession(client, row.user_id);
    return {
      user: publicUser(account),
      csrfToken: await deriveCsrfToken(session.rawToken),
      setCookie: serializeSessionCookie(session.rawToken),
    };
  });
}

export async function updateAccount(
  session: SessionContext,
  body: Record<string, unknown>,
): Promise<{ user: AuthenticatedUser }> {
  // Username and e-mail are not self-editable yet — only the display name and password.
  if (body.username !== undefined) {
    throw new ApiError(403, "username_locked", "O nome de usuário não pode ser alterado.");
  }
  if (body.email !== undefined) {
    throw new ApiError(403, "email_locked", "A edição de e-mail está desativada por enquanto.");
  }
  const wantsName = body.name !== undefined;
  const wantsPassword = typeof body.newPassword === "string" && body.newPassword !== "";
  if (!wantsName && !wantsPassword) {
    throw new ApiError(400, "nothing_to_update", "Nada para atualizar.");
  }
  const name = wantsName ? displayName(body.name) : null;
  const newPasswordHash = wantsPassword ? await hashPassword(body.newPassword).catch(() => {
    throw new ApiError(400, "invalid_password", "A nova senha precisa ter ao menos 10 caracteres.");
  }) : null;

  return inTransaction(async (client) => {
    if (wantsPassword) {
      const current = await oneOrNull<{ password_hash: string }>(
        client,
        "SELECT password_hash FROM users WHERE id = $1 FOR UPDATE",
        [session.user.id],
      );
      if (!current || !(await verifyPassword(body.currentPassword, current.password_hash))) {
        throw new ApiError(403, "invalid_current_password", "Senha atual incorreta.");
      }
    }
    if (wantsName) {
      await client.query("UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1", [session.user.id, name]);
    }
    if (wantsPassword) {
      await client.query(
        "UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1",
        [session.user.id, newPasswordHash],
      );
      await client.query(
        "UPDATE sessions SET revoked_at = now(), revoke_reason = 'password_change' WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL",
        [session.user.id, session.id],
      );
    }
    const account = await oneOrNull<UserRow>(
      client,
      `SELECT id, display_name, username, email, password_hash, platform_admin FROM users WHERE id = $1`,
      [session.user.id],
    );
    if (!account) throw new Error("User row vanished during account update.");
    return { user: publicUser(account) };
  });
}

/**
 * Finds who inherits a group when its sole owner leaves: the longest-tenured
 * active admin, or — if there is none — the longest-tenured active
 * participant (who becomes owner directly; there is no separate "promote to
 * admin first" step). Only called for a group that `other_members > 0`
 * already guaranteed has someone else to hand it to.
 */
async function findOwnershipSuccessor(
  client: PoolClient,
  groupId: string,
  departingUserId: string,
): Promise<string> {
  const successor = await oneOrNull<{ user_id: string }>(
    client,
    `SELECT user_id FROM group_members
      WHERE group_id = $1 AND removed_at IS NULL AND user_id <> $2
      ORDER BY (role = 'admin') DESC, joined_at ASC
      LIMIT 1`,
    [groupId, departingUserId],
  );
  if (!successor) throw new ApiError(500, "internal_error", "Não foi possível encontrar quem herda o grupo.");
  return successor.user_id;
}

/**
 * Self-service account removal. A solo-owned group is soft-deleted along with
 * the account — nobody else depended on it. A group with other active people
 * never gets destroyed or blocked on manual cleanup: ownership transfers
 * automatically (oldest admin, or oldest member if there is no other admin) —
 * no question asked, same "it just happens" rule as leaving a group. The
 * account row is kept but scrubbed of PII and disabled; a hard purge is an
 * `/admin` follow-up.
 */
export async function deleteOwnAccount(session: SessionContext): Promise<{ setCookie: string }> {
  await inTransaction(async (client) => {
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [session.user.id]);

    const ownedGroups = await client.query<{ id: string; name: string; other_members: number }>(
      `SELECT g.id, g.name,
              (SELECT count(*)::int FROM group_members m
                WHERE m.group_id = g.id AND m.removed_at IS NULL AND m.user_id <> $1) AS other_members
         FROM groups g
         JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
          AND gm.role = 'owner' AND gm.removed_at IS NULL
        WHERE g.deleted_at IS NULL`,
      [session.user.id],
    );

    for (const group of ownedGroups.rows) {
      if (group.other_members === 0) {
        await client.query(
          `UPDATE groups SET deleted_at = now(), deleted_by_user_id = $2, updated_at = now() WHERE id = $1`,
          [group.id, session.user.id],
        );
        await client.query(
          `INSERT INTO audit_events
            (id, group_id, challenge_id, actor_user_id, action, entity_type, entity_id, before, after, metadata, created_at)
           VALUES ($1,$2,NULL,$3,'group.deleted','group',$2,$4::jsonb,NULL,'{"reason":"account_deleted"}'::jsonb,now())`,
          [crypto.randomUUID(), group.id, session.user.id, JSON.stringify({ name: group.name })],
        );
        continue;
      }

      // Demote the departing owner first — otherwise promoting the successor
      // to 'owner' while this row still holds that role would momentarily
      // give the group two active owners, which the unique index refuses.
      const successorId = await findOwnershipSuccessor(client, group.id, session.user.id);
      await client.query(
        "UPDATE group_members SET role = 'participant' WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL",
        [group.id, session.user.id],
      );
      await client.query("UPDATE group_members SET role = 'owner' WHERE group_id = $1 AND user_id = $2", [group.id, successorId]);
      await client.query("UPDATE groups SET owner_user_id = $2, updated_at = now() WHERE id = $1", [group.id, successorId]);
      await client.query(
        `INSERT INTO audit_events
          (id, group_id, challenge_id, actor_user_id, action, entity_type, entity_id, before, after, metadata, created_at)
         VALUES ($1,$2,NULL,$3,'group.ownership_transferred','group',$2,$4::jsonb,$5::jsonb,'{"reason":"account_deleted"}'::jsonb,now())`,
        [crypto.randomUUID(), group.id, session.user.id, JSON.stringify({ ownerUserId: session.user.id }), JSON.stringify({ ownerUserId: successorId })],
      );
    }

    await client.query(
      "UPDATE group_members SET removed_at = now() WHERE user_id = $1 AND removed_at IS NULL",
      [session.user.id],
    );
    // Same close-out as leaving a group by hand — otherwise a deleted account
    // keeps showing as an active participant (just under the scrubbed name).
    await client.query(
      "UPDATE challenge_participants SET removed_at = now() WHERE user_id = $1 AND removed_at IS NULL",
      [session.user.id],
    );
    await client.query(
      `UPDATE users
          SET deleted_at = now(), disabled_at = now(),
              display_name = 'Conta removida', email = NULL, email_normalized = NULL,
              updated_at = now()
        WHERE id = $1`,
      [session.user.id],
    );
    await client.query(
      "UPDATE sessions SET revoked_at = now(), revoke_reason = 'account_deleted' WHERE user_id = $1 AND revoked_at IS NULL",
      [session.user.id],
    );
    console.warn("auth.deleteAccount", { userId: session.user.id });
  });

  return { setCookie: clearSessionCookie() };
}

export async function sessionFromToken(rawToken: string | null): Promise<SessionContext | null> {
  if (!rawToken) return null;

  let tokenHash: string;
  try {
    tokenHash = await hashToken(rawToken);
  } catch {
    return null;
  }

  return withClient(async (client) => {
    const row = await oneOrNull<SessionRow>(
      client,
      `SELECT s.id AS session_id, u.id, u.display_name, u.username, u.email, u.password_hash,
              u.platform_admin
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
          AND u.disabled_at IS NULL`,
      [tokenHash],
    );
    if (!row) return null;
    await client.query(
      `UPDATE sessions SET last_seen_at = now()
        WHERE id = $1 AND last_seen_at < now() - interval '15 minutes'`,
      [row.session_id],
    );
    return { id: row.session_id, rawToken, user: publicUser(row) };
  });
}

export async function sessionFromRequest(request: Request): Promise<SessionContext | null> {
  return sessionFromToken(cookieValue(request, SESSION_COOKIE_NAME));
}

export async function requireSession(request: Request): Promise<SessionContext> {
  const session = await sessionFromRequest(request);
  if (!session) throw new ApiError(401, "unauthenticated", "Entre na sua conta para continuar.");
  return session;
}

export async function requireMutationSession(request: Request): Promise<SessionContext> {
  requireMutationOrigin(request);
  const session = await requireSession(request);
  if (!(await verifyCsrfToken(session.rawToken, request.headers.get("x-csrf-token")))) {
    throw new ApiError(403, "invalid_csrf", "Token de segurança inválido.");
  }
  return session;
}

/** Read-only platform-admin gate: 404 (not 403) so the console stays invisible. */
export async function requirePlatformAdminSession(request: Request): Promise<SessionContext> {
  const session = await sessionFromRequest(request);
  if (!session?.user.platformAdmin) {
    throw new ApiError(404, "not_found", "Recurso não encontrado.");
  }
  return session;
}

/** Mutating platform-admin gate: origin + CSRF + the flag. */
export async function requirePlatformAdminMutation(request: Request): Promise<SessionContext> {
  const session = await requireMutationSession(request);
  if (!session.user.platformAdmin) {
    throw new ApiError(404, "not_found", "Recurso não encontrado.");
  }
  return session;
}

export async function logoutSession(session: SessionContext): Promise<string> {
  await withClient(async (client) => {
    await client.query(
      "UPDATE sessions SET revoked_at = now(), revoke_reason = 'logout' WHERE id = $1 AND revoked_at IS NULL",
      [session.id],
    );
  });
  return clearSessionCookie();
}

export async function csrfForSession(session: SessionContext): Promise<string> {
  return deriveCsrfToken(session.rawToken);
}

export async function groupRole(userId: string, groupId: string, client?: PoolClient): Promise<GroupRole | null> {
  const work = async (activeClient: PoolClient) => {
    const row = await oneOrNull<{ role: GroupRole }>(
      activeClient,
      `SELECT gm.role FROM group_members gm
         JOIN groups g ON g.id = gm.group_id
        WHERE gm.group_id = $1 AND gm.user_id = $2 AND gm.removed_at IS NULL
          AND (g.kind = 'standard' OR (g.kind = 'personal' AND g.owner_user_id = $2))`,
      [groupId, userId],
    );
    return row?.role ?? null;
  };
  return client ? work(client) : withClient(work);
}

export async function requireGroupRole(
  userId: string,
  groupId: string,
  allowed: readonly GroupRole[],
  client?: PoolClient,
): Promise<GroupRole> {
  const role = await groupRole(userId, groupId, client);
  if (!role) throw new ApiError(404, "not_found", "Grupo não encontrado.");
  if (!allowed.includes(role)) throw new ApiError(403, "forbidden", "Você não pode executar esta ação.");
  return role;
}

export const LOGIN_SECURITY_POLICY = Object.freeze({
  maxFailures: LOGIN_MAX_FAILURES,
  windowMs: LOGIN_WINDOW_MS,
});
