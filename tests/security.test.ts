import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { test } from "node:test";

import {
  OPAQUE_TOKEN_BYTES,
  PASSWORD_HASH_BYTES,
  PASSWORD_HASH_ITERATIONS,
  PASSWORD_SALT_BYTES,
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  deriveCsrfToken,
  generateOpaqueToken,
  hashPassword,
  hashToken,
  isExactOrigin,
  normalizeUsername,
  requestHasExactOrigin,
  serializeSessionCookie,
  timingSafeEqual,
  verifyCsrfToken,
  verifyPassword,
} from "../lib/security";

// The repository requires Node 22, where Web Crypto is global. The execution
// image currently uses Node 18, so tests inject that runtime's mature Web
// Crypto implementation without adding a production dependency.
const testCrypto = webcrypto as unknown as Crypto;

test("username normalization is canonical, ASCII-only, and bounded", () => {
  assert.equal(normalizeUsername("  User.Name-_1  "), "user.name-_1");
  assert.equal(normalizeUsername(" ＥＤＵ_01 "), "edu_01");

  for (const invalid of ["ab", "a".repeat(33), "edu ardo", "eduardo!", "josé", "_starts_wrong"] as const) {
    assert.throws(() => normalizeUsername(invalid));
  }

  assert.throws(() => normalizeUsername(null), TypeError);
});

test("password hashes use the versioned 600k PBKDF2-SHA256 format and preserve whitespace", { timeout: 15_000 }, async () => {
  const password = " 123456789";
  const firstHash = await hashPassword(password, testCrypto);
  const secondHash = await hashPassword(password, testCrypto);
  const parts = firstHash.split("$");

  assert.equal(parts[0], "PBKDF2-SHA256");
  assert.equal(parts[1], "v=1");
  assert.equal(parts[2], `i=${PASSWORD_HASH_ITERATIONS}`);
  assert.equal(parts[3], `l=${PASSWORD_HASH_BYTES}`);
  assert.equal(Buffer.from(parts[4], "base64url").byteLength, PASSWORD_SALT_BYTES);
  assert.equal(Buffer.from(parts[5], "base64url").byteLength, PASSWORD_HASH_BYTES);
  assert.notEqual(firstHash, secondHash, "a new salt must produce a different stored hash");

  assert.equal(await verifyPassword(password, firstHash, testCrypto), true);
  assert.equal(await verifyPassword(password.trim(), firstHash, testCrypto), false, "passwords must never be trimmed");
  assert.equal(await verifyPassword(`${password}!`, firstHash, testCrypto), false);
  assert.equal(await verifyPassword(password, "malformed", testCrypto), false);

  await assert.rejects(() => hashPassword("123456789", testCrypto), RangeError);
});

test("timing-safe comparison checks all bytes and rejects length differences", () => {
  assert.equal(timingSafeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3)), true);
  assert.equal(timingSafeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 4)), false);
  assert.equal(timingSafeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3, 0)), false);
});

test("opaque tokens contain 256 random bits and only their SHA-256 hash is stored", async () => {
  const firstToken = generateOpaqueToken(testCrypto);
  const secondToken = generateOpaqueToken(testCrypto);
  const firstHash = await hashToken(firstToken, testCrypto);

  assert.match(firstToken, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(Buffer.from(firstToken, "base64url").byteLength, OPAQUE_TOKEN_BYTES);
  assert.notEqual(firstToken, secondToken);
  assert.match(firstHash, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(firstHash, firstToken);
  assert.equal(await hashToken(firstToken, testCrypto), firstHash, "token lookup hashes must be deterministic");

  await assert.rejects(() => hashToken("not-a-256-bit-token", testCrypto), TypeError);
});

test("session cookies use the __Host contract and can be expired safely", () => {
  const token = generateOpaqueToken(testCrypto);
  const cookie = serializeSessionCookie(token, 3600);
  const cleared = clearSessionCookie();

  assert.equal(cookie.startsWith(`${SESSION_COOKIE_NAME}=${token};`), true);
  for (const attribute of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=3600"] as const) {
    assert.equal(cookie.includes(attribute), true, `missing cookie attribute: ${attribute}`);
  }
  assert.equal(cookie.includes("Domain="), false, "__Host cookies must not set Domain");

  assert.equal(cleared.startsWith(`${SESSION_COOKIE_NAME}=;`), true);
  assert.equal(cleared.includes("Max-Age=0"), true);
  assert.equal(cleared.includes("Expires=Thu, 01 Jan 1970 00:00:00 GMT"), true);

  assert.throws(() => serializeSessionCookie("invalid", 3600), TypeError);
  assert.throws(() => serializeSessionCookie(token, 0), RangeError);
});

test("CSRF tokens are deterministic per session and fail closed", async () => {
  const sessionToken = generateOpaqueToken(testCrypto);
  const otherSessionToken = generateOpaqueToken(testCrypto);
  const csrfToken = await deriveCsrfToken(sessionToken, testCrypto);

  assert.match(csrfToken, /^csrf-v1\.[A-Za-z0-9_-]{43}$/u);
  assert.equal(await deriveCsrfToken(sessionToken, testCrypto), csrfToken);
  assert.notEqual(await deriveCsrfToken(otherSessionToken, testCrypto), csrfToken);
  assert.equal(await verifyCsrfToken(sessionToken, csrfToken, testCrypto), true);
  assert.equal(await verifyCsrfToken(otherSessionToken, csrfToken, testCrypto), false);
  assert.equal(await verifyCsrfToken(sessionToken, `${csrfToken}x`, testCrypto), false);
  assert.equal(await verifyCsrfToken("invalid", csrfToken, testCrypto), false);
});

test("origin checks accept only the configured, exact HTTP origin", () => {
  const expected = "https://goa.example";

  assert.equal(isExactOrigin(expected, expected), true);
  assert.equal(isExactOrigin(expected, `${expected}/route`), true, "configuration paths normalize to their origin");
  assert.equal(isExactOrigin("https://evil.goa.example", expected), false);
  assert.equal(isExactOrigin("https://goa.example.evil.test", expected), false);
  assert.equal(isExactOrigin("http://goa.example", expected), false);
  assert.equal(isExactOrigin(`${expected}/path`, expected), false);
  assert.equal(isExactOrigin(null, expected), false);
  assert.equal(isExactOrigin("null", expected), false);
  assert.equal(isExactOrigin(expected, "javascript:alert(1)"), false);

  const request = new Request(`${expected}/api/test`, { headers: { Origin: expected } });
  assert.equal(requestHasExactOrigin(request, expected), true);
});
