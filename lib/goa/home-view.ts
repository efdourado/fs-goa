import type { SessionContext } from "../auth";
import { getPool } from "../db";
import { ApiError } from "../http";

/**
 * How Home arranges the two sides of someone's challenges — their own and their groups'. Private to the person,
 * saved on their account so it follows them between devices. `null` (never picked) lets Home decide from what
 * they actually use.
 */
export type HomeSection = "personal" | "groups";
export interface HomeView {
  layout: "mixed" | "separated";
  /** Separated only: which side comes first. */
  order: HomeSection[];
  /** Separated only: sides left off Home (never both). */
  hidden: HomeSection[];
}

const SECTIONS: HomeSection[] = ["personal", "groups"];

function sectionList(value: unknown, what: string): HomeSection[] {
  if (!Array.isArray(value) || value.some((entry) => !SECTIONS.includes(entry as HomeSection)) || new Set(value).size !== value.length) {
    throw new ApiError(400, "invalid_home_view", `\`${what}\` inválido.`);
  }
  return value as HomeSection[];
}

/** Checks a saved view; `null` in the body clears it back to automatic. */
export function parseHomeView(body: Record<string, unknown>): HomeView | null {
  if (body.view === null) return null;
  const view = body.view as Record<string, unknown> | undefined;
  if (!view || typeof view !== "object") throw new ApiError(400, "invalid_home_view", "Informe a visualização.");
  if (view.layout !== "mixed" && view.layout !== "separated") throw new ApiError(400, "invalid_home_view", "`layout` inválido.");
  const order = sectionList(view.order ?? SECTIONS, "order");
  if (order.length !== SECTIONS.length) throw new ApiError(400, "invalid_home_view", "`order` precisa ter as duas seções.");
  const hidden = sectionList(view.hidden ?? [], "hidden");
  if (hidden.length === SECTIONS.length) throw new ApiError(400, "invalid_home_view", "Pelo menos uma seção fica visível.");
  return { layout: view.layout, order, hidden };
}

export async function setHomeView(session: SessionContext, body: Record<string, unknown>) {
  const view = parseHomeView(body);
  await getPool().query("UPDATE users SET home_view = $2::jsonb, updated_at = now() WHERE id = $1", [
    session.user.id,
    view === null ? null : JSON.stringify(view),
  ]);
  return { homeView: view };
}
