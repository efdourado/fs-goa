import {
  loginAccount,
  logoutSession,
  registerAccount,
  requireMutationSession,
  requireSession,
  sessionFromRequest,
} from "@/lib/auth";
import {
  addMetric,
  curateResults,
  duplicateChallenge,
  exportEntriesCsv,
  getChallengeDetail,
  listEntries,
  publicResults,
  saveEntry,
  saveChallengeFields,
  saveChallengeItems,
  setChallengeParticipants,
  transitionChallenge,
  updateChallenge,
  updateEntry,
} from "@/lib/goa-challenges";
import {
  acceptInvite,
  bootstrap,
  createChallenge,
  createGroup,
  createInvite,
  previewInvite,
} from "@/lib/goa-domain";
import { getPool } from "@/lib/db";
import {
  ApiError,
  handleApi,
  json,
  notFound,
  readJsonObject,
  requireMutationOrigin,
} from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function segments(request: Request): string[] {
  return new URL(request.url).pathname.split("/").filter(Boolean).slice(1);
}

function isPath(path: string[], ...expected: string[]): boolean {
  return path.length === expected.length && path.every((part, index) => part === expected[index]);
}

export async function GET(request: Request): Promise<Response> {
  return handleApi(async () => {
    const path = segments(request);
    if (isPath(path, "health")) {
      const database = await getPool().query<{ now: Date }>("SELECT now() AS now");
      return json({ ok: true, database: database.rows[0]?.now?.toISOString() ?? null });
    }
    if (isPath(path, "bootstrap")) return json(await bootstrap(await sessionFromRequest(request)));
    if (path[0] === "invites" && path.length === 2) return json(await previewInvite(path[1]));
    if (path[0] === "results" && path.length === 2) return json(await publicResults(path[1]));
    if (path[0] === "challenges" && path.length === 2) {
      return json(await getChallengeDetail(await requireSession(request), path[1]));
    }
    if (path[0] === "challenges" && path[2] === "entries" && path.length === 3) {
      return json({ entries: await listEntries(await requireSession(request), path[1]) });
    }
    if (path[0] === "challenges" && path[2] === "export.csv" && path.length === 3) {
      return exportEntriesCsv(await requireSession(request), path[1]);
    }
    return notFound();
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleApi(async () => {
    const path = segments(request);
    if (isPath(path, "auth", "register")) {
      requireMutationOrigin(request);
      const result = await registerAccount(await readJsonObject(request));
      return json({ user: result.user, csrfToken: result.csrfToken }, 201, { "set-cookie": result.setCookie });
    }
    if (isPath(path, "auth", "login")) {
      requireMutationOrigin(request);
      const result = await loginAccount(await readJsonObject(request));
      return json({ user: result.user, csrfToken: result.csrfToken }, 200, { "set-cookie": result.setCookie });
    }
    if (isPath(path, "auth", "logout")) {
      const session = await requireMutationSession(request);
      return json({ ok: true }, 200, { "set-cookie": await logoutSession(session) });
    }

    const session = await requireMutationSession(request);
    const body = await readJsonObject(request);
    if (isPath(path, "groups")) return json(await createGroup(session, body), 201);
    if (path[0] === "groups" && path[2] === "invites" && path.length === 3) {
      const result = await createInvite(session, path[1], body);
      const origin = new URL(request.url).origin;
      return json({ ...result, url: `${origin}/?invite=${encodeURIComponent(result.token)}` }, 201);
    }
    if (path[0] === "invites" && path.length === 2) return json(await acceptInvite(session, path[1]));
    if (path[0] === "groups" && path[2] === "challenges" && path.length === 3) {
      return json(await createChallenge(session, path[1], body), 201);
    }
    if (path[0] === "challenges" && path[2] === "participants" && path.length === 3) {
      return json(await setChallengeParticipants(session, path[1], body));
    }
    if (path[0] === "challenges" && path[2] === "fields" && path.length === 3) {
      return json(await saveChallengeFields(session, path[1], body), 201);
    }
    if (path[0] === "challenges" && path[2] === "items" && path.length === 3) {
      return json(await saveChallengeItems(session, path[1], body), 201);
    }
    if (path[0] === "challenges" && path[2] === "metrics" && path.length === 3) {
      return json(await addMetric(session, path[1], body), 201);
    }
    if (path[0] === "challenges" && path[2] === "entries" && path.length === 3) {
      return json(await saveEntry(session, path[1], body), 201);
    }
    if (path[0] === "challenges" && path[2] === "transition" && path.length === 3) {
      return json(await transitionChallenge(session, path[1], body));
    }
    if (path[0] === "challenges" && path[2] === "duplicate" && path.length === 3) {
      return json(await duplicateChallenge(session, path[1], body), 201);
    }
    if (path[0] === "challenges" && path[2] === "results" && path.length === 3) {
      const result = await curateResults(session, path[1], body);
      return json({
        ...result,
        url: result.shareToken
          ? `${new URL(request.url).origin}/results/${encodeURIComponent(result.shareToken)}`
          : null,
      });
    }
    throw new ApiError(404, "not_found", "Rota não encontrada.");
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return handleApi(async () => {
    const path = segments(request);
    const session = await requireMutationSession(request);
    const body = await readJsonObject(request);
    if (path[0] === "challenges" && path.length === 2) {
      return json(await updateChallenge(session, path[1], body));
    }
    if (path[0] === "entries" && path.length === 2) {
      return json(await updateEntry(session, path[1], body));
    }
    return notFound();
  });
}
