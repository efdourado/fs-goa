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
    if ((error as { code?: string }).code === "23505") {
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
  let username: string;
  try {
    username = normalizeUsername(body.username);
  } catch {
    username = "invalid_login";
  }
  const password = body.password;

  return inTransaction(async (client) => {
    if (!(await loginAllowed(client, username))) {
      throw new ApiError(429, "login_limited", "Muitas tentativas. Aguarde 15 minutos.");
    }
    const row = await oneOrNull<UserRow>(
      client,
      `SELECT id, display_name, username, email, password_hash, platform_admin
         FROM users WHERE username_normalized = $1 AND disabled_at IS NULL`,
      [username],
    );
    const matches = await verifyPassword(password, row?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!row || !matches) {
      await recordLoginFailure(client, username);
      throw new ApiError(401, "invalid_credentials", "Usuário ou senha incorretos.");
    }

    await client.query("DELETE FROM login_attempts WHERE username_normalized = $1", [username]);
    const session = await createSession(client, row.id);
    return {
      user: publicUser(row),
      csrfToken: await deriveCsrfToken(session.rawToken),
      setCookie: serializeSessionCookie(session.rawToken),
    };
  });
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
      `SELECT role FROM group_members
        WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL`,
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

