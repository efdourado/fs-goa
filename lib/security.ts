const textEncoder = new TextEncoder();

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_BYTES = 1024;

export const PASSWORD_HASH_VERSION = 1;
export const PASSWORD_HASH_ITERATIONS = 600_000;
export const PASSWORD_HASH_BYTES = 32;
export const PASSWORD_SALT_BYTES = 16;

export const OPAQUE_TOKEN_BYTES = 32;
export const SESSION_COOKIE_NAME = "__Host-goa_session";
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const PASSWORD_HASH_NAME = "PBKDF2-SHA256";
const CSRF_VERSION = "csrf-v1";
const CSRF_CONTEXT = textEncoder.encode("goa:csrf:v1");
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

type CryptoProvider = Pick<Crypto, "getRandomValues" | "subtle">;

function currentCrypto(): CryptoProvider {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is not available in this runtime.");
  }

  return globalThis.crypto;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!value || !BASE64URL_PATTERN.test(value)) {
    return null;
  }

  const paddingLength = (4 - (value.length % 4)) % 4;
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat(paddingLength);

  try {
    const binary = atob(base64);
    const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));

    return encodeBase64Url(decoded) === value ? decoded : null;
  } catch {
    return null;
  }
}

function randomBytes(length: number, cryptoProvider: CryptoProvider): Uint8Array {
  const bytes = new Uint8Array(length);
  cryptoProvider.getRandomValues(bytes);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function passwordLength(password: string): number {
  return Array.from(password).length;
}

function assertPasswordCanBeStored(password: unknown): asserts password is string {
  if (typeof password !== "string") {
    throw new TypeError("Password must be a string.");
  }

  if (passwordLength(password) < PASSWORD_MIN_LENGTH) {
    throw new RangeError(`Password must have at least ${PASSWORD_MIN_LENGTH} characters.`);
  }

  if (textEncoder.encode(password).byteLength > PASSWORD_MAX_BYTES) {
    throw new RangeError(`Password must have at most ${PASSWORD_MAX_BYTES} UTF-8 bytes.`);
  }
}

function isPasswordCandidate(value: unknown): value is string {
  return typeof value === "string" && textEncoder.encode(value).byteLength <= PASSWORD_MAX_BYTES;
}

async function derivePasswordHash(
  password: string,
  salt: Uint8Array,
  cryptoProvider: CryptoProvider,
): Promise<Uint8Array> {
  const keyMaterial = await cryptoProvider.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await cryptoProvider.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: PASSWORD_HASH_ITERATIONS,
      salt: toArrayBuffer(salt),
    },
    keyMaterial,
    PASSWORD_HASH_BYTES * 8,
  );

  return new Uint8Array(bits);
}

interface ParsedPasswordHash {
  digest: Uint8Array;
  salt: Uint8Array;
}

function parsePasswordHash(encodedHash: string): ParsedPasswordHash | null {
  const parts = encodedHash.split("$");

  if (
    parts.length !== 6 ||
    parts[0] !== PASSWORD_HASH_NAME ||
    parts[1] !== `v=${PASSWORD_HASH_VERSION}` ||
    parts[2] !== `i=${PASSWORD_HASH_ITERATIONS}` ||
    parts[3] !== `l=${PASSWORD_HASH_BYTES}`
  ) {
    return null;
  }

  const salt = decodeBase64Url(parts[4]);
  const digest = decodeBase64Url(parts[5]);

  if (!salt || salt.byteLength < PASSWORD_SALT_BYTES || !digest || digest.byteLength !== PASSWORD_HASH_BYTES) {
    return null;
  }

  return { digest, salt };
}

function isOpaqueToken(token: unknown): token is string {
  if (typeof token !== "string") {
    return false;
  }

  const bytes = decodeBase64Url(token);
  return bytes?.byteLength === OPAQUE_TOKEN_BYTES;
}

/**
 * Builds the canonical, case-insensitive key used for username lookup.
 * Display names should be stored separately and may use Unicode.
 */
export function normalizeUsername(username: unknown): string {
  if (typeof username !== "string") {
    throw new TypeError("Username must be a string.");
  }

  const normalized = username.trim().normalize("NFKC").toLowerCase();

  if (normalized.length < USERNAME_MIN_LENGTH || normalized.length > USERNAME_MAX_LENGTH) {
    throw new RangeError(
      `Username must have between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters.`,
    );
  }

  if (!USERNAME_PATTERN.test(normalized)) {
    throw new TypeError("Username may contain only ASCII letters, numbers, dots, underscores, and hyphens.");
  }

  return normalized;
}

/** Hashes a password without trimming or Unicode-normalizing it. */
export async function hashPassword(
  password: unknown,
  cryptoProvider: CryptoProvider = currentCrypto(),
): Promise<string> {
  assertPasswordCanBeStored(password);

  const salt = randomBytes(PASSWORD_SALT_BYTES, cryptoProvider);
  const digest = await derivePasswordHash(password, salt, cryptoProvider);

  return [
    PASSWORD_HASH_NAME,
    `v=${PASSWORD_HASH_VERSION}`,
    `i=${PASSWORD_HASH_ITERATIONS}`,
    `l=${PASSWORD_HASH_BYTES}`,
    encodeBase64Url(salt),
    encodeBase64Url(digest),
  ].join("$");
}

/**
 * Verifies a stored password hash. Malformed or obsolete hash formats fail
 * closed; the digest comparison itself always traverses the full buffers.
 */
export async function verifyPassword(
  password: unknown,
  encodedHash: unknown,
  cryptoProvider: CryptoProvider = currentCrypto(),
): Promise<boolean> {
  if (!isPasswordCandidate(password) || typeof encodedHash !== "string") {
    return false;
  }

  const parsed = parsePasswordHash(encodedHash);
  if (!parsed) {
    return false;
  }

  const candidateDigest = await derivePasswordHash(password, parsed.salt, cryptoProvider);
  return timingSafeEqual(candidateDigest, parsed.digest);
}

/** Constant-work byte comparison for equal-length cryptographic values. */
export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const maximumLength = Math.max(left.byteLength, right.byteLength);
  let difference = left.byteLength ^ right.byteLength;

  for (let index = 0; index < maximumLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
}

/** Returns a 256-bit, URL-safe token suitable for sessions or invitations. */
export function generateOpaqueToken(cryptoProvider: CryptoProvider = currentCrypto()): string {
  return encodeBase64Url(randomBytes(OPAQUE_TOKEN_BYTES, cryptoProvider));
}

/** Hashes a generated token for storage; raw tokens must never be persisted. */
export async function hashToken(
  token: unknown,
  cryptoProvider: CryptoProvider = currentCrypto(),
): Promise<string> {
  if (!isOpaqueToken(token)) {
    throw new TypeError("Token must be a canonical 256-bit base64url value.");
  }

  const digest = await cryptoProvider.subtle.digest("SHA-256", textEncoder.encode(token));
  return encodeBase64Url(new Uint8Array(digest));
}

/** Creates a CSRF token cryptographically bound to the current session. */
export async function deriveCsrfToken(
  sessionToken: unknown,
  cryptoProvider: CryptoProvider = currentCrypto(),
): Promise<string> {
  if (!isOpaqueToken(sessionToken)) {
    throw new TypeError("Session token must be a canonical 256-bit base64url value.");
  }

  const sessionKeyBytes = decodeBase64Url(sessionToken);
  if (!sessionKeyBytes) {
    throw new TypeError("Session token is invalid.");
  }

  const key = await cryptoProvider.subtle.importKey(
    "raw",
    toArrayBuffer(sessionKeyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await cryptoProvider.subtle.sign("HMAC", key, CSRF_CONTEXT);

  return `${CSRF_VERSION}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyCsrfToken(
  sessionToken: unknown,
  candidateToken: unknown,
  cryptoProvider: CryptoProvider = currentCrypto(),
): Promise<boolean> {
  if (typeof candidateToken !== "string") {
    return false;
  }

  try {
    const expectedToken = await deriveCsrfToken(sessionToken, cryptoProvider);
    return timingSafeEqual(textEncoder.encode(expectedToken), textEncoder.encode(candidateToken));
  } catch {
    return false;
  }
}

/** Exact origin comparison: suffixes, paths, missing origins, and `null` fail. */
export function isExactOrigin(originHeader: string | null, expectedOrigin: string): boolean {
  if (!originHeader || originHeader === "null") {
    return false;
  }

  try {
    const expectedUrl = new URL(expectedOrigin);
    if (expectedUrl.protocol !== "https:" && expectedUrl.protocol !== "http:") {
      return false;
    }

    return originHeader === expectedUrl.origin;
  } catch {
    return false;
  }
}

export function requestHasExactOrigin(request: Pick<Request, "headers">, expectedOrigin: string): boolean {
  return isExactOrigin(request.headers.get("Origin"), expectedOrigin);
}

export function serializeSessionCookie(
  sessionToken: unknown,
  maxAgeSeconds = SESSION_COOKIE_MAX_AGE_SECONDS,
): string {
  if (!isOpaqueToken(sessionToken)) {
    throw new TypeError("Session cookie requires a canonical 256-bit base64url token.");
  }

  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new RangeError("Session cookie Max-Age must be a positive integer.");
  }

  return `${SESSION_COOKIE_NAME}=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
