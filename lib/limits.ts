import { ApiError } from "./http";

function positiveIntEnv(name: string, fallback: number): number {
  const raw = typeof process !== "undefined" ? process.env[name] : undefined;
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Creation caps kept deliberately low while Goa is effectively single-tenant.
 * All are per owner / per group (not global) and can be raised via env.
 */
export const LIMITS = {
  get groupsPerOwner(): number {
    return positiveIntEnv("MAX_GROUPS_PER_OWNER", 6);
  },
  get challengesPerGroup(): number {
    return positiveIntEnv("MAX_CHALLENGES_PER_GROUP", 6);
  },
  get membersPerGroup(): number {
    return positiveIntEnv("MAX_MEMBERS_PER_GROUP", 62);
  },
};

export function assertUnder(count: number, limit: number, code: string, message: string): void {
  if (count >= limit) throw new ApiError(403, code, message);
}

/**
 * Rejects oversized request arrays before they reach the database. Keeps a
 * hostile payload (e.g. a million participant ids) from turning into a giant
 * `ANY($1)` scan or a runaway transaction.
 */
export function assertArrayWithin(value: unknown, max: number, message: string): void {
  if (Array.isArray(value) && value.length > max) {
    throw new ApiError(400, "too_many_items", message);
  }
}
