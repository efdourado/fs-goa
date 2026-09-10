import { createInterface } from "node:readline/promises";
import process from "node:process";

import type { SessionContext } from "../../lib/auth";
import { oneOrNull, withClient } from "../../lib/db";
import { SYNTHETIC_MARKER } from "../../lib/goa/synthetic";

export { SYNTHETIC_MARKER };

export const SEED_USERNAME = "dudupizzas";

export interface SeedAccount {
  id: string;
  username: string;
  name: string;
  email: string | null;
  platformAdmin: boolean;
}

class SeedError extends Error {}
export function fail(message: string): never { throw new SeedError(message); }
export function isSeedError(error: unknown): error is Error { return error instanceof SeedError; }

function normalizeUsername(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase();
}

/** Looks up the target account. Never creates or edits it. */
export async function resolveAccount(): Promise<SeedAccount> {
  return withClient(async (client) => {
    const row = await oneOrNull<{
      id: string; username: string; display_name: string; email: string | null;
      platform_admin: boolean; disabled_at: Date | null; deactivated_at: Date | null; deleted_at: Date | null;
    }>(
      client,
      `SELECT id, username, display_name, email, platform_admin, disabled_at, deactivated_at, deleted_at
         FROM users WHERE username_normalized = $1`,
      [normalizeUsername(SEED_USERNAME)],
    );
    if (!row) fail(`A conta "${SEED_USERNAME}" não existe. Crie-a pelo cadastro normal antes de rodar a seed.`);
    if (row.deleted_at) fail(`A conta "${SEED_USERNAME}" foi removida.`);
    if (row.disabled_at) fail(`A conta "${SEED_USERNAME}" está banida.`);
    if (row.deactivated_at) fail(`A conta "${SEED_USERNAME}" está desativada. Reative-a antes de rodar a seed.`);
    return {
      id: row.id,
      username: row.username,
      name: row.display_name,
      email: row.email,
      platformAdmin: row.platform_admin,
    };
  });
}

/** A `SessionContext` shim for the domain services. */
export function sessionFor(account: SeedAccount): SessionContext {
  return {
    id: `seed-reading:${account.id}`,
    rawToken: "seed-reading",
    user: {
      id: account.id,
      name: account.name,
      username: account.username,
      email: account.email,
      platformAdmin: account.platformAdmin,
      deactivated: false,
    },
  };
}

export interface CliOptions { dryRun: boolean; reset: boolean }

export function parseArgs(argv: string[]): CliOptions {
  let dryRun = false;
  let reset = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--reset") reset = true;
    else fail(`Argumento não reconhecido: ${arg}`);
  }
  return { dryRun, reset };
}

/** `n` days after (negative = before) an ISO date, back to `YYYY-MM-DD`. */
export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A finished window of `days` that ends `endGap` days before today (inclusive count). */
export function pastWindow(days: number, endGap = 3): { startsOn: string; endsOn: string } {
  const endsOn = addDays(new Date().toISOString().slice(0, 10), -endGap);
  return { startsOn: addDays(endsOn, -(days - 1)), endsOn };
}

export interface ChallengeShape {
  typeByPurpose: Map<string, string>;
  fieldId: (key: string, purpose?: string) => string;
  itemId: (title: string) => string;
}

/** Reads back the ids the domain generated for a freshly created challenge. */
export async function readShape(challengeId: string): Promise<ChallengeShape> {
  return withClient(async (client) => {
    const items = await client.query<{ id: string; title: string }>(
      "SELECT id, title FROM challenge_items WHERE challenge_id = $1 AND archived_at IS NULL ORDER BY position",
      [challengeId],
    );
    const rows = await client.query<{
      type_id: string; purpose: string; is_primary: boolean; field_id: string | null; field_key: string | null;
    }>(
      `SELECT et.id AS type_id, et.purpose, et.is_primary, cf.id AS field_id, cf.semantic_key AS field_key
         FROM entry_types et
         LEFT JOIN challenge_fields cf ON cf.entry_type_id = et.id AND cf.archived_at IS NULL
        WHERE et.challenge_id = $1 AND et.archived_at IS NULL`,
      [challengeId],
    );
    const typeByPurpose = new Map<string, string>();
    const byQualified = new Map<string, string>();
    const byBareKey = new Map<string, string>();
    for (const row of rows.rows) {
      typeByPurpose.set(row.purpose, row.type_id);
      if (row.field_id && row.field_key) {
        byQualified.set(`${row.purpose}.${row.field_key}`, row.field_id);
        if (row.is_primary) byBareKey.set(row.field_key, row.field_id);
      }
    }
    const itemsByTitle = new Map(items.rows.map((row) => [row.title, row.id]));
    return {
      typeByPurpose,
      fieldId: (key, purpose) => {
        const id = purpose ? byQualified.get(`${purpose}.${key}`) : byBareKey.get(key) ?? byQualified.get(key);
        if (!id) throw new Error(`campo "${purpose ? `${purpose}.` : ""}${key}" não encontrado`);
        return id;
      },
      itemId: (title) => {
        const id = itemsByTitle.get(title);
        if (!id) throw new Error(`item "${title}" não encontrado`);
        return id;
      },
    };
  });
}

/**
 * Backdates the challenge's `activated_at` / `closed_at` so a run that took
 * seconds looks like it spanned its 90 days — needed for the day-based
 * completion rate and any "closed N days ago" copy. Timestamps only; every
 * content row still went through the real services.
 */
export async function backdateLifecycle(challengeId: string, activatedOn: string, closedOn: string): Promise<void> {
  await withClient((client) =>
    client.query(
      `UPDATE challenges
          SET activated_at = ($2::date + time '08:00') AT TIME ZONE time_zone,
              closed_at    = ($3::date + time '22:00') AT TIME ZONE time_zone,
              updated_at   = now()
        WHERE id = $1`,
      [challengeId, activatedOn, closedOn],
    ),
  );
}

/** The one seeded personal reading challenge — matched by the marker in its description. */
export async function findSeedChallenge(ownerId: string): Promise<{ id: string; title: string; status: string } | null> {
  return withClient((client) =>
    oneOrNull<{ id: string; title: string; status: string }>(
      client,
      `SELECT c.id, c.title, c.status
         FROM challenges c
         JOIN groups g ON g.id = c.group_id
        WHERE g.owner_user_id = $1 AND g.kind = 'personal' AND c.deleted_at IS NULL
          AND c.description LIKE $2
        ORDER BY c.created_at DESC
        LIMIT 1`,
      [ownerId, `%${SYNTHETIC_MARKER}%`],
    ),
  );
}

const REMOTE_CONFIRM_PHRASE = "seed reading";

export function looksRemote(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  return !/@(localhost|127\.0\.0\.1|::1|postgres)\b/.test(url) && !/\bhost=(localhost|127\.0\.0\.1)\b/.test(url);
}

export async function confirmRemote(action: string): Promise<void> {
  if (!looksRemote()) return;
  if (process.env.SEED_READING_CONFIRM?.trim() === REMOTE_CONFIRM_PHRASE) return;
  if (!process.stdin.isTTY) {
    fail(`DATABASE_URL aponta para um banco remoto. Para ${action}, defina SEED_READING_CONFIRM="${REMOTE_CONFIRM_PHRASE}" ou rode num terminal interativo.`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`\nDATABASE_URL parece remoto (Neon). Você vai ${action}.\nDigite "${REMOTE_CONFIRM_PHRASE}" para continuar: `);
    if (answer.trim() !== REMOTE_CONFIRM_PHRASE) fail("Confirmação não confere. Nada foi feito.");
  } finally {
    rl.close();
  }
}
