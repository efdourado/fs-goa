import { createInterface } from "node:readline/promises";
import process from "node:process";

import type { SessionContext } from "../../lib/auth";
import { getPool, oneOrNull, withClient } from "../../lib/db";
import { purgeGroupRows } from "../../lib/goa/purge";

/**
 * `db:seed-demo` builds a self-contained demonstration group so the Wrapped,
 * rankings, weekly schedule and large lists can be reviewed against real volume
 * instead of empty screens. It drives the **domain services** (never raw SQL for
 * content), so every row goes through the same rules a person would hit.
 *
 * The public domain services open and commit their own transactions, so there is
 * no global rollback: a normal run writes progressively. If it fails midway the
 * partial group is left in place, tagged by the marker below; the next run finds
 * it and refuses to continue until `--reset` removes it.
 */

export const DEMO_GROUP_NAME = "Laboratório GOA — Dados de demonstração";
/** Embedded in the group description so `--reset` can only ever match a seed group. */
export const SYNTHETIC_MARKER = "⟦seed-demo⟧";
export const DEMO_GROUP_DESCRIPTION =
  "Grupo de demonstração do GOA. Todas as opiniões, notas e comentários aqui são "
  + `fictícios e gerados automaticamente por \`npm run db:seed-demo\`. ${SYNTHETIC_MARKER}`;

export const DEMO_USERNAMES = {
  owner: "dudupizzas",
  admin: "admin",
  participant: "teste",
} as const;

export type DemoRole = keyof typeof DEMO_USERNAMES;

export interface DemoAccount {
  id: string;
  username: string;
  name: string;
  email: string | null;
  platformAdmin: boolean;
}

export interface CliOptions {
  scenario: string;
  dryRun: boolean;
  reset: boolean;
}

export interface SeedContext {
  options: CliOptions;
  accounts: Record<DemoRole, DemoAccount>;
  /** A `SessionContext` shim per demo account — enough for the domain services. */
  session: Record<DemoRole, SessionContext>;
  groupId: string;
  log: (message: string) => void;
}

class SeedError extends Error {}

export function fail(message: string): never {
  throw new SeedError(message);
}

export function isSeedError(error: unknown): error is Error {
  return error instanceof SeedError;
}

export function parseArgs(argv: string[]): CliOptions {
  let scenario = "all";
  let dryRun = false;
  let reset = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--reset") reset = true;
    else if (arg.startsWith("--scenario=")) scenario = arg.slice("--scenario=".length).trim();
    else fail(`Argumento não reconhecido: ${arg}`);
  }
  if (!scenario) fail("Passe --scenario=<cinema|library|bookshelf|habit|all>.");
  return { scenario, dryRun, reset };
}

function normalizeUsername(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase();
}

/**
 * Looks up the three fixed accounts. Never creates or edits them — a seed run
 * must not touch passwords, e-mail or global roles. Aborts if one is missing,
 * deactivated or banned, or if `admin` lacks `platform_admin` (needed to publish
 * the templates).
 */
export async function resolveAccounts(): Promise<Record<DemoRole, DemoAccount>> {
  return withClient(async (client) => {
    const out = {} as Record<DemoRole, DemoAccount>;
    for (const [role, username] of Object.entries(DEMO_USERNAMES) as Array<[DemoRole, string]>) {
      const row = await oneOrNull<{
        id: string; username: string; display_name: string; email: string | null;
        platform_admin: boolean; disabled_at: Date | null; deactivated_at: Date | null;
        deleted_at: Date | null;
      }>(
        client,
        `SELECT id, username, display_name, email, platform_admin, disabled_at, deactivated_at, deleted_at
           FROM users WHERE username_normalized = $1`,
        [normalizeUsername(username)],
      );
      if (!row) fail(`A conta "${username}" não existe. Crie-a pelo cadastro normal antes de rodar a seed.`);
      if (row.deleted_at) fail(`A conta "${username}" foi removida.`);
      if (row.disabled_at) fail(`A conta "${username}" está banida (disabled_at).`);
      if (row.deactivated_at) fail(`A conta "${username}" está desativada. Reative-a antes de rodar a seed.`);
      out[role] = {
        id: row.id,
        username: row.username,
        name: row.display_name,
        email: row.email,
        platformAdmin: row.platform_admin,
      };
    }
    if (!out.admin.platformAdmin) {
      fail(`A conta "${out.admin.username}" precisa de platform_admin para publicar os modelos (rode \`npm run db:seed\`).`);
    }
    return out;
  });
}

export function sessionFor(account: DemoAccount): SessionContext {
  return {
    id: `seed-demo:${account.id}`,
    rawToken: "seed-demo",
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

interface DemoGroupRow {
  id: string;
  name: string;
  created_at: Date;
  challenges: number;
  members: number;
  entries: number;
}

/** The one synthetic group for an owner: exact name **and** the marker in the description. */
export async function findDemoGroup(ownerId: string): Promise<DemoGroupRow | null> {
  return withClient((client) =>
    oneOrNull<DemoGroupRow>(
      client,
      `SELECT g.id, g.name, g.created_at,
              (SELECT count(*)::int FROM challenges c WHERE c.group_id = g.id) AS challenges,
              (SELECT count(*)::int FROM group_members m WHERE m.group_id = g.id AND m.removed_at IS NULL) AS members,
              (SELECT count(*)::int FROM entries e
                 JOIN challenges c ON c.id = e.challenge_id
                WHERE c.group_id = g.id) AS entries
         FROM groups g
        WHERE g.owner_user_id = $1 AND g.kind = 'standard' AND g.deleted_at IS NULL
          AND g.name = $2 AND g.description LIKE $3`,
      [ownerId, DEMO_GROUP_NAME, `%${SYNTHETIC_MARKER}%`],
    ),
  );
}

/** True when `DATABASE_URL` is not an obvious local database. */
export function looksRemote(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  return !/@(localhost|127\.0\.0\.1|::1|postgres)\b/.test(url) && !/\bhost=(localhost|127\.0\.0\.1)\b/.test(url);
}

const REMOTE_CONFIRM_PHRASE = "seed demo";

export async function confirmRemote(action: string): Promise<void> {
  if (!looksRemote()) return;
  const preset = process.env.SEED_DEMO_CONFIRM?.trim();
  if (preset === REMOTE_CONFIRM_PHRASE) return;
  if (!process.stdin.isTTY) {
    fail(
      `DATABASE_URL aponta para um banco remoto e a confirmação não foi dada. Para ${action}, `
      + `defina SEED_DEMO_CONFIRM="${REMOTE_CONFIRM_PHRASE}" ou rode num terminal interativo.`,
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      `\nDATABASE_URL parece remoto (Neon). Você vai ${action}.\n`
      + `Digite "${REMOTE_CONFIRM_PHRASE}" para continuar: `,
    );
    if (answer.trim() !== REMOTE_CONFIRM_PHRASE) fail("Confirmação não confere. Nada foi feito.");
  } finally {
    rl.close();
  }
}

export async function resetDemoGroup(group: DemoGroupRow): Promise<void> {
  await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      // Re-check inside the transaction that this is still a marked seed group.
      const guard = await oneOrNull<{ id: string }>(
        client,
        `SELECT id FROM groups
          WHERE id = $1 AND kind = 'standard' AND deleted_at IS NULL
            AND name = $2 AND description LIKE $3 FOR UPDATE`,
        [group.id, DEMO_GROUP_NAME, `%${SYNTHETIC_MARKER}%`],
      );
      if (!guard) fail("O grupo de demonstração mudou entre a checagem e o reset. Rode de novo.");
      await purgeGroupRows(client, group.id);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export async function closePool(): Promise<void> {
  await getPool().end();
}
