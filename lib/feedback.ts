import type { SessionContext } from "./auth";
import { inTransaction, withClient } from "./db";
import { ApiError, stringValue } from "./http";

const IMPACTS = new Set(["blocked", "effort", "minor", "idea"]);
const HOURLY_CAP = 20;

function optionalText(body: Record<string, unknown>, key: string, max: number): string | null {
  const value = body[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ApiError(400, "invalid_field", `${key} precisa ser texto.`);
  const clean = value.trim();
  if (!clean) return null;
  if (Array.from(clean).length > max) {
    throw new ApiError(400, "invalid_field", `${key} pode ter no máximo ${max} caracteres.`);
  }
  return clean;
}

function optionalBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "boolean") throw new ApiError(400, "invalid_field", "Valor booleano inválido.");
  return value;
}

export interface FeedbackContext {
  appVersion: string | null;
}

/**
 * Stores a "how can we improve?" submission. Accepts an anonymous sender (no
 * session). Never records group/challenge content — only what the person typed
 * plus the neutral context the client attached.
 */
export async function submitFeedback(
  session: SessionContext | null,
  body: Record<string, unknown>,
  context: FeedbackContext,
): Promise<{ ok: true }> {
  const area = stringValue(body, "area", { min: 1, max: 400 })!;
  const goal = stringValue(body, "goal", { min: 1, max: 400 })!;
  const impact = typeof body.impact === "string" ? body.impact : "";
  if (!IMPACTS.has(impact)) throw new ApiError(400, "invalid_impact", "Selecione o impacto.");

  const succeeded = optionalBoolean(body.succeeded);
  let ease: number | null = null;
  if (body.ease !== undefined && body.ease !== null && body.ease !== "") {
    ease = Number(body.ease);
    if (!Number.isInteger(ease) || ease < 1 || ease > 5) {
      throw new ApiError(400, "invalid_ease", "A facilidade vai de 1 a 5.");
    }
  }

  const friction = optionalText(body, "friction", 4_000);
  const wish = optionalText(body, "wish", 4_000);
  const workaround = optionalText(body, "workaround", 4_000);
  const contactOk = optionalBoolean(body.contactOk) === true;
  const contactEmail = contactOk ? optionalText(body, "contactEmail", 254) : null;
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(contactEmail)) {
    throw new ApiError(400, "invalid_email", "E-mail de contato inválido.");
  }

  const route = optionalText(body, "route", 200);
  const locale = optionalText(body, "locale", 20);
  const templateKind = optionalText(body, "templateKind", 40);
  const userRole = optionalText(body, "userRole", 40);

  await inTransaction(async (client) => {
    if (session) {
      const recent = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM feedback
          WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
        [session.user.id],
      );
      if ((recent.rows[0]?.count ?? 0) >= HOURLY_CAP) {
        throw new ApiError(429, "feedback_throttled", "Você já enviou bastante coisa por agora. Volte em uma hora.");
      }
    }
    await client.query(
      `INSERT INTO feedback
        (id, user_id, route, app_version, locale, template_kind, user_role, form_version,
         area, goal, succeeded, ease, friction, impact, workaround, wish,
         contact_email, contact_ok, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now())`,
      [
        crypto.randomUUID(),
        session?.user.id ?? null,
        route,
        context.appVersion,
        locale,
        templateKind,
        userRole,
        area,
        goal,
        succeeded,
        ease,
        friction,
        impact,
        workaround,
        wish,
        contactEmail,
        contactOk,
      ],
    );
  });

  return { ok: true };
}

export async function adminFeedback() {
  return withClient(async (client) => {
    const result = await client.query<{
      id: string;
      created_at: Date;
      area: string;
      goal: string;
      impact: string;
      succeeded: boolean | null;
      ease: number | null;
      friction: string | null;
      wish: string | null;
      workaround: string | null;
      route: string | null;
      locale: string | null;
      template_kind: string | null;
      user_role: string | null;
      app_version: string | null;
      contact_email: string | null;
      contact_ok: boolean;
      username: string | null;
    }>(
      `SELECT f.id, f.created_at, f.area, f.goal, f.impact, f.succeeded, f.ease, f.friction,
              f.wish, f.workaround, f.route, f.locale, f.template_kind, f.user_role, f.app_version,
              f.contact_email, f.contact_ok, u.username
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
        ORDER BY f.created_at DESC
        LIMIT 200`,
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at.toISOString(),
        area: row.area,
        goal: row.goal,
        impact: row.impact,
        succeeded: row.succeeded,
        ease: row.ease,
        friction: row.friction,
        wish: row.wish,
        workaround: row.workaround,
        route: row.route,
        locale: row.locale,
        templateKind: row.template_kind,
        userRole: row.user_role,
        appVersion: row.app_version,
        contact: row.contact_ok ? row.contact_email : null,
        username: row.username,
      })),
    };
  });
}
