import {
  loginAccount,
  logoutSession,
  registerAccount,
  requestPasswordReset,
  requireMutationSession,
  requirePlatformAdminMutation,
  requirePlatformAdminSession,
  deleteOwnAccount,
  requireSession,
  resetPassword,
  sessionFromRequest,
  updateAccount,
} from "@/lib/auth";
import {
  adminAudit,
  adminOverview,
  adminResetLink,
  adminTrash,
  adminUsers,
  purgeTrashItem,
  revokeUserSessions,
  setUserDisabled,
  setUserPlatformAdmin,
} from "@/lib/admin";
import { adminFeedback, submitFeedback } from "@/lib/feedback";
import { catalogItemDetail, listGroupCatalog, updateCatalogItem } from "@/lib/goa/catalog";
import {
  addMetric,
  archiveChallengeItem,
  curateResults,
  duplicateChallenge,
  duplicateTemplate,
  exportEntriesCsv,
  getChallengeDetail,
  getTemplateDetail,
  listEntries,
  listTemplates,
  publicResults,
  publishResults,
  saveEntry,
  saveChallengeFields,
  saveChallengeItems,
  setChallengeParticipants,
  setChallengeTemplate,
  softDeleteChallenge,
  transitionChallenge,
  unpublishChallengeResults,
  unpublishChallengeTemplate,
  updateChallenge,
  updateChallengeItem,
  updateEntry,
} from "@/lib/goa-challenges";
import {
  acceptInvite,
  bootstrap,
  cancelMemberRequest,
  createChallenge,
  createGroup,
  createInvite,
  previewInvite,
  requestGroupMember,
  respondToMemberRequest,
  softDeleteGroup,
  updateGroup,
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
    if (path[0] === "admin") {
      await requirePlatformAdminSession(request);
      if (isPath(path, "admin", "overview")) return json(await adminOverview());
      if (isPath(path, "admin", "users")) return json(await adminUsers());
      if (isPath(path, "admin", "trash")) return json(await adminTrash());
      if (isPath(path, "admin", "feedback")) return json(await adminFeedback());
      if (isPath(path, "admin", "audit")) return json(await adminAudit(new URL(request.url).searchParams));
      return notFound();
    }
    if (path[0] === "invites" && path.length === 2) {
      return json(await previewInvite(path[1], await sessionFromRequest(request)));
    }
    if (isPath(path, "templates")) return json(await listTemplates());
    if (path[0] === "templates" && path.length === 2) return json(await getTemplateDetail(path[1]));
    if (path[0] === "results" && path.length === 2) return json(await publicResults(path[1]));
    if (path[0] === "groups" && path[2] === "catalog" && path.length === 3) {
      return json(await listGroupCatalog(await requireSession(request), path[1]));
    }
    if (path[0] === "groups" && path[2] === "catalog" && path.length === 4) {
      return json(await catalogItemDetail(await requireSession(request), path[1], path[3]));
    }
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
    if (isPath(path, "auth", "forgot")) {
      requireMutationOrigin(request);
      return json(await requestPasswordReset(await readJsonObject(request)), 202);
    }
    if (isPath(path, "auth", "reset")) {
      requireMutationOrigin(request);
      const result = await resetPassword(await readJsonObject(request));
      return json({ user: result.user, csrfToken: result.csrfToken }, 200, { "set-cookie": result.setCookie });
    }

    if (isPath(path, "feedback")) {
      requireMutationOrigin(request);
      const result = await submitFeedback(
        await sessionFromRequest(request),
        await readJsonObject(request),
        { appVersion: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null },
      );
      return json(result, 201);
    }

    if (path[0] === "admin") {
      const adminSession = await requirePlatformAdminMutation(request);
      const adminBody = await readJsonObject(request);
      if (isPath(path, "admin", "trash", "purge")) return json(await purgeTrashItem(adminSession, adminBody));
      if (isPath(path, "admin", "users", "disable")) return json(await setUserDisabled(adminSession, adminBody));
      if (isPath(path, "admin", "users", "set-admin")) return json(await setUserPlatformAdmin(adminSession, adminBody));
      if (isPath(path, "admin", "users", "revoke-sessions")) {
        return json(await revokeUserSessions(adminSession, adminBody));
      }
      if (isPath(path, "admin", "users", "reset-link")) {
        return json(await adminResetLink(adminSession, adminBody, new URL(request.url).origin));
      }
      return notFound();
    }

    const session = await requireMutationSession(request);
    const body = await readJsonObject(request);
    if (isPath(path, "groups")) return json(await createGroup(session, body), 201);
    if (path[0] === "groups" && path[2] === "members" && path.length === 3) {
      return json(await requestGroupMember(session, path[1], body));
    }
    if (path[0] === "member-requests" && path.length === 3 && path[2] === "accept") {
      return json(await respondToMemberRequest(session, path[1], "accept"));
    }
    if (path[0] === "member-requests" && path.length === 3 && path[2] === "decline") {
      return json(await respondToMemberRequest(session, path[1], "decline"));
    }
    if (path[0] === "member-requests" && path.length === 3 && path[2] === "cancel") {
      return json(await cancelMemberRequest(session, path[1]));
    }
    if (path[0] === "groups" && path[2] === "invites" && path.length === 3) {
      const result = await createInvite(session, path[1], body);
      const origin = new URL(request.url).origin;
      return json({ ...result, url: `${origin}/invites/${encodeURIComponent(result.token)}` }, 201);
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
    if (path[0] === "challenges" && path[2] === "template" && path.length === 3) {
      return json(await setChallengeTemplate(session, path[1], body));
    }
    if (path[0] === "templates" && path[2] === "duplicate" && path.length === 3) {
      return json(await duplicateTemplate(session, path[1], body), 201);
    }
    if (path[0] === "challenges" && path[2] === "results" && path[3] === "publish" && path.length === 4) {
      const result = await publishResults(session, path[1], body);
      return json({
        ...result,
        url: `${new URL(request.url).origin}/results/${encodeURIComponent(result.shareToken)}`,
      });
    }
    if (path[0] === "challenges" && path[2] === "results" && path.length === 3) {
      return json(await curateResults(session, path[1], body));
    }
    throw new ApiError(404, "not_found", "Rota não encontrada.");
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return handleApi(async () => {
    const path = segments(request);
    const session = await requireMutationSession(request);
    const body = await readJsonObject(request);
    if (isPath(path, "account")) {
      return json(await updateAccount(session, body));
    }
    if (path[0] === "catalog" && path.length === 2) {
      return json(await updateCatalogItem(session, path[1], body));
    }
    if (path[0] === "groups" && path.length === 2) {
      return json(await updateGroup(session, path[1], body));
    }
    if (path[0] === "challenges" && path[2] === "items" && path.length === 4) {
      return json(await updateChallengeItem(session, path[1], path[3], body));
    }
    if (path[0] === "challenges" && path.length === 2) {
      return json(await updateChallenge(session, path[1], body));
    }
    if (path[0] === "entries" && path.length === 2) {
      return json(await updateEntry(session, path[1], body));
    }
    return notFound();
  });
}

export async function DELETE(request: Request): Promise<Response> {
  return handleApi(async () => {
    const path = segments(request);
    const session = await requireMutationSession(request);
    if (isPath(path, "account")) {
      const result = await deleteOwnAccount(session);
      return json({ ok: true }, 200, { "set-cookie": result.setCookie });
    }
    if (path[0] === "groups" && path.length === 2) {
      return json(await softDeleteGroup(session, path[1]));
    }
    if (path[0] === "challenges" && path[2] === "items" && path.length === 4) {
      return json(await archiveChallengeItem(session, path[1], path[3]));
    }
    if (path[0] === "challenges" && path[2] === "template" && path.length === 3) {
      return json(await unpublishChallengeTemplate(session, path[1]));
    }
    if (path[0] === "challenges" && path[2] === "results" && path.length === 3) {
      return json(await unpublishChallengeResults(session, path[1]));
    }
    if (path[0] === "challenges" && path.length === 2) {
      return json(await softDeleteChallenge(session, path[1]));
    }
    return notFound();
  });
}
