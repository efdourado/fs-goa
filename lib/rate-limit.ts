import { getPool } from "./db";
import { ApiError } from "./http";

/**
 * How many requests fit in a window, per IP (anonymous doors: sign-up, login, feedback, public links) or per
 * account (every write). Generous for a person, tight for a script: a bot can't mint accounts, guess passwords
 * from one address, flood the feedback box, hammer a public link's live rankings, or grow a group without bound.
 */
export const RATE_LIMITS = {
  register: { limit: 10, windowSeconds: 60 * 60 },
  login: { limit: 30, windowSeconds: 10 * 60 },
  feedback: { limit: 10, windowSeconds: 60 * 60 },
  publicRead: { limit: 120, windowSeconds: 60 },
  write: { limit: 120, windowSeconds: 60 },
  writeDaily: { limit: 5_000, windowSeconds: 24 * 60 * 60 },
} as const;

type Rule = keyof typeof RATE_LIMITS;

/**
 * The caller's address — only where the platform sets it (Vercel overwrites `x-forwarded-for` / `x-real-ip`
 * itself). Anywhere else a client could forge the header, so there is no IP and IP limits don't apply.
 */
export function clientIp(request: Request): string | null {
  if (!process.env.VERCEL) return null;
  const forwarded = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0];
  const ip = forwarded?.trim();
  return ip ? ip.slice(0, 64) : null;
}

/**
 * Counts one request against `rule` for `subject` and refuses it (429) past the limit. A fixed window per key,
 * one upsert per request. If the counter itself fails (the table missing mid-deploy, a blip) the request goes
 * through: the limiter is a guard, never the reason the app is down.
 */
export async function rateLimit(rule: Rule, subject: string | null): Promise<void> {
  if (!subject || process.env.GOA_RATE_LIMITS === "off") return;
  const { limit, windowSeconds } = RATE_LIMITS[rule];
  let hits: number;
  let retryAfter: number;
  try {
    const pool = getPool();
    const result = await pool.query<{ hits: number; retry_after: number }>(
      `INSERT INTO rate_limits (key, window_started_at, hits) VALUES ($1, now(), 1)
       ON CONFLICT (key) DO UPDATE SET
         hits = CASE WHEN rate_limits.window_started_at <= now() - make_interval(secs => $2) THEN 1 ELSE rate_limits.hits + 1 END,
         window_started_at = CASE WHEN rate_limits.window_started_at <= now() - make_interval(secs => $2) THEN now() ELSE rate_limits.window_started_at END
       RETURNING hits, ceil(extract(epoch FROM window_started_at + make_interval(secs => $2) - now()))::int AS retry_after`,
      [`${rule}:${subject}`, windowSeconds],
    );
    hits = result.rows[0]?.hits ?? 0;
    retryAfter = Math.max(1, result.rows[0]?.retry_after ?? windowSeconds);
    // Old windows are dead weight; sweep them now and then rather than on a schedule.
    if (Math.random() < 0.01) {
      void pool.query("DELETE FROM rate_limits WHERE window_started_at < now() - interval '2 days'").catch(() => undefined);
    }
  } catch (error) {
    console.warn("Rate limit check skipped", { rule, message: error instanceof Error ? error.message : String(error) });
    return;
  }
  if (hits > limit) {
    throw new ApiError(429, "rate_limited", "Muitas tentativas seguidas. Espere um pouco e tente de novo.", { retryAfterSeconds: retryAfter });
  }
}

/** Every write an account makes: a burst limit and a daily one. */
export async function rateLimitWrites(userId: string): Promise<void> {
  await Promise.all([rateLimit("write", userId), rateLimit("writeDaily", userId)]);
}
