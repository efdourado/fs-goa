import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import process from "node:process";
import pg from "pg";

// Mirrors lib/security.ts so a seeded hash verifies exactly like a hash the app
// produces on registration: PBKDF2-HMAC-SHA256, 600k iterations, 16-byte salt,
// 32-byte digest, both encoded as unpadded base64url.
const HASH_NAME = "PBKDF2-SHA256";
const HASH_VERSION = 1;
const HASH_ITERATIONS = 600_000;
const HASH_BYTES = 32;
const SALT_BYTES = 16;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

function fail(message) {
  console.error(`seed-admin: ${message}`);
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

const username = (process.env.ADMIN_USERNAME ?? "admin").trim().normalize("NFKC").toLowerCase();
const displayName = (process.env.ADMIN_NAME ?? "Administrador").trim();
const password = process.env.ADMIN_PASSWORD ?? "";

if (username.length < 3 || username.length > 32 || !USERNAME_PATTERN.test(username)) {
  fail("ADMIN_USERNAME deve ter de 3 a 32 caracteres [a-z0-9._-], começando por letra ou número.");
}
if (Array.from(password).length < 10) {
  fail("ADMIN_PASSWORD é obrigatória e precisa de ao menos 10 caracteres.");
}
if (Array.from(displayName).length < 1 || Array.from(displayName).length > 80) {
  fail("ADMIN_NAME precisa ter de 1 a 80 caracteres.");
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

try {
  const result = await pool.query(
    `INSERT INTO users
       (id, display_name, username, username_normalized, password_hash,
        password_changed_at, platform_admin, created_at, updated_at)
     VALUES ($1, $2, $3, $3, $4, now(), true, now(), now())
     ON CONFLICT (username_normalized) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       password_hash = EXCLUDED.password_hash,
       password_changed_at = now(),
       platform_admin = true,
       updated_at = now(),
       disabled_at = NULL
     RETURNING id, (xmax = 0) AS created`,
    [randomUUID(), displayName, username, hashPassword(password)],
  );
  const { id, created } = result.rows[0];
  console.log(`Administrador ${created ? "criado" : "atualizado"}: @${username} (${id})`);
} finally {
  await pool.end();
}
