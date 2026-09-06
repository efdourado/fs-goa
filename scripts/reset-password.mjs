import { pbkdf2Sync, randomBytes } from "node:crypto";
import process from "node:process";
import pg from "pg";

/*
 * Operator-only password recovery.
 *
 * The product deliberately has no admin-issued reset link: a platform admin who
 * could mint one could take over any account and read its private content,
 * which ROADMAP §14 forbids. Recovery therefore requires `DATABASE_URL` —
 * something the `platform_admin` flag does not grant — so it is an
 * infrastructure action, auditable outside the app, not a console button.
 *
 *   DATABASE_URL=… node scripts/reset-password.mjs <usuario|email> '<nova senha>'
 *
 * Every session of the account is revoked, so whoever held it is signed out.
 */

// Mirrors lib/security.ts exactly, so the hash verifies like one the app makes.
const HASH_NAME = "PBKDF2-SHA256";
const HASH_VERSION = 1;
const HASH_ITERATIONS = 600_000;
const HASH_BYTES = 32;
const SALT_BYTES = 16;
const MIN_PASSWORD_LENGTH = 10;

function fail(message) {
  console.error(`reset-password: ${message}`);
  process.exit(1);
}

function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const digest = pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_BYTES, "sha256");
  return [
    HASH_NAME,
    `v=${HASH_VERSION}`,
    `i=${HASH_ITERATIONS}`,
    `l=${HASH_BYTES}`,
    salt.toString("base64url"),
    digest.toString("base64url"),
  ].join("$");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail("DATABASE_URL não foi definida.");

const [identifier, password] = process.argv.slice(2);
if (!identifier || !password) {
  fail("uso: node scripts/reset-password.mjs <usuario|email> '<nova senha>'");
}
if (password.length < MIN_PASSWORD_LENGTH) {
  fail(`a nova senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`);
}

const normalized = identifier.trim().toLowerCase();
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

try {
  const target = await pool.query(
    `SELECT id, username, deleted_at, disabled_at FROM users
      WHERE username_normalized = $1 OR email_normalized = $1`,
    [normalized],
  );
  if (!target.rowCount) fail(`nenhuma conta com "${identifier}".`);
  const user = target.rows[0];
  if (user.deleted_at) fail("essa conta foi excluída permanentemente; não há o que recuperar.");

  await pool.query(
    `UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1`,
    [user.id, hashPassword(password)],
  );
  const revoked = await pool.query(
    `UPDATE sessions SET revoked_at = now(), revoke_reason = 'operator_reset'
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [user.id],
  );
  await pool.query(
    "UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
    [user.id],
  );
  console.log(
    `reset-password: senha de @${user.username} redefinida; ${revoked.rowCount ?? 0} sessão(ões) revogada(s).`
      + (user.disabled_at ? " A conta segue desativada — reative pelo /admin." : ""),
  );
} finally {
  await pool.end();
}
