import { ApiError } from "./http";

function positiveIntEnv(name: string, fallback: number): number {
  const raw = typeof process !== "undefined" ? process.env[name] : undefined;
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Per-account and per-group caps, with optional environment overrides. */
export const LIMITS = {
  get groupsPerOwner(): number {
    return positiveIntEnv("MAX_GROUPS_PER_OWNER", 90);
  },
  get challengesPerGroup(): number {
    return positiveIntEnv("MAX_CHALLENGES_PER_GROUP", 30);
  },
  /** The caller's personal workspace has its own challenge cap. */
  get challengesPerPersonalSpace(): number {
    return positiveIntEnv("MAX_CHALLENGES_PER_PERSONAL_SPACE", 30);
  },
  get membersPerGroup(): number {
    return positiveIntEnv("MAX_MEMBERS_PER_GROUP", 62);
  },
  /**
   * How many groups a single account may belong to (any role, owned included).
   * Generous — years of revisitable challenge groups — but bounds the blast
   * radius of a hostile flow adding someone everywhere and keeps bootstrap cheap.
   */
  get groupsPerMember(): number {
    return positiveIntEnv("MAX_GROUPS_PER_MEMBER", 90);
  },
  /** Open incoming member requests one account can accumulate before new ones are refused. */
  get pendingInvitesPerUser(): number {
    return positiveIntEnv("MAX_PENDING_INVITES_PER_USER", 31);
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
