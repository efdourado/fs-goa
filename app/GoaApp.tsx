"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";

import {
  API_PATHS,
  apiRequest,
  normalizeBootstrap,
  normalizeChallenge,
  normalizeCreatedId,
  normalizeEntries,
} from "./goa/api";
import { useGoaFormat } from "./goa/format";
import { AboutScreen } from "./goa/screens/about";
import { AccountScreen } from "./goa/screens/account";
import { AccountDeactivatedScreen } from "./goa/screens/account-deactivated";
import { AdminScreen } from "./goa/screens/admin";
import { AuthScreen } from "./goa/screens/auth";
import { CreateChallengeScreen } from "./goa/screens/create-challenge";
import { DashboardScreen } from "./goa/screens/dashboard";
import { CatalogItemScreen } from "./goa/screens/catalog-item";
import { GroupScreen } from "./goa/screens/group";
import { InviteAcceptedScreen, InviteScreen } from "./goa/screens/invite";
import { ParticipantChallengeScreen } from "./goa/screens/participant-challenge";
import { CatalogWorkspaceScreen } from "./goa/screens/catalog-workspace";
import { CsrfProvider } from "./goa/csrf";
import { PersonalSpaceScreen } from "./goa/screens/personal-space";
import { PersonalTrashScreen } from "./goa/screens/personal-trash";
import { TrashView } from "./goa/trash-view";
import { TemplateDetailScreen, TemplatesScreen } from "./goa/screens/templates";
import { type BackLabel, type BackLookup, backTargetFor, isSameView, screenFromUrl, urlForScreen } from "./goa/navigation";
import type {
  AdminTab,
  BootstrapData,
  ChallengeCreationInput,
  CopyResult,
  SkippedProperty,
  ChallengeDetail,
  Entry,
  GroupInviteResult,
  Id,
  ImportPreview,
  InviteAcceptance,
  ParticipantTab,
  Screen,
} from "./goa/types";
import { CACHE_KEYS, clearCache, readCache, writeCache } from "./goa/cache";
import { AppHeader, BackButton, Brand, Button, cardClass, cx, EmptyState, LoadingView, PageHeading } from "./goa/ui";
import { canManage, isPersonalChallenge } from "./goa/utils";

export default function GoaApp() {
  const t = useTranslations("app");
  const tc = useTranslations("common");
  const tTrash = useTranslations("trash");
  const tPersonalCatalog = useTranslations("personalCatalog");
  const tBack = useTranslations("backTo");
  const f = useGoaFormat();
  const fRef = useRef(f);
  fRef.current = f;
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(null);
  const [pendingRoute, setPendingRoute] = useState<Screen | null>(null);
  const [resumeTemplateCopy, setResumeTemplateCopy] = useState<Id | null>(null);
  const [selectedChallenge, setSelectedChallenge] = useState<ChallengeDetail | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  // How deep the app's own history stack is (0 = the entry the visit started on), the last screen
  // synced to the URL (to tell a tab switch from a real nav), and the screen each entry shows —
  // so "Back" can tell whether the entry right behind us is the parent it wants.
  const navDepth = useRef(0);
  const syncedScreen = useRef<Screen | null>(null);
  const entryScreens = useRef<Screen[]>([]);
  // The next screen change should take the place of the current history entry instead of adding one
  // (going "up", finishing a form, deleting what you were looking at).
  const replaceNext = useRef(false);
  // Whether the screen on screen right now actually owns a pushed history entry. A screen with no URL
  // (account, auth, loading) never gets one — the address bar keeps showing whatever it showed
  // before — so popping history from there would skip past where "Back" should land.
  const currentEntryPushed = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const queryToken = new URLSearchParams(window.location.search).get("invite");
    const pathMatch = window.location.pathname.match(/\/invites?\/([^/]+)/);
    const inviteToken = queryToken || (pathMatch ? decodeURIComponent(pathMatch[1]) : null);
    const routed = screenFromUrl(window.location.pathname, window.location.search);

    const PUBLIC_KINDS = new Set<Screen["kind"]>(["templates", "template", "about"]);
    const resolveScreen = (data: BootstrapData): Screen => {
      if (inviteToken) return { kind: "invite", token: inviteToken };
      // A public page (gallery, template, about) opens for a logged-out visitor
      // straight from its URL — the session check comes after.
      if (routed && PUBLIC_KINDS.has(routed.kind)) return routed;
      if (!data.user) return { kind: "auth", mode: "login" };
      return routed && routed.kind !== "invite" ? routed : { kind: "dashboard" };
    };

    // Paint from the last known bootstrap so the first screen is instant, then
    // revalidate against the database in the background.
    const cachedRaw = readCache<BootstrapData>(CACHE_KEYS.bootstrap);
    const cached = cachedRaw ? normalizeBootstrap(cachedRaw) : null;
    let revalidated = false;
    if (cached) {
      void Promise.resolve().then(() => {
        if (!active || revalidated) return;
        if (inviteToken) setPendingInviteToken(inviteToken);
        setBootstrap(cached);
        setScreen(resolveScreen(cached));
      });
    }

    apiRequest<BootstrapData | { bootstrap: BootstrapData }>(API_PATHS.bootstrap, { signal: controller.signal })
      .then((raw) => {
        if (!active) return;
        revalidated = true;
        const data = normalizeBootstrap(raw);
        writeCache(CACHE_KEYS.bootstrap, data);
        if (inviteToken) setPendingInviteToken(inviteToken);
        setBootstrap(data);
        if (!data.user && !inviteToken && routed && routed.kind !== "dashboard") {
          setPendingRoute(routed);
        }
        setScreen(resolveScreen(data));
      })
      .catch((cause: unknown) => {
        if (!active || (cause instanceof DOMException && cause.name === "AbortError")) return;
        if (!cached) setBootError(fRef.current.error(cause));
      });
    return () => { active = false; controller.abort(); };
  }, []);

  // Keep the address bar in step with the current screen so every view is shareable. A tab switch
  // within the same view — or a change flagged `replaceNext` — replaces the entry; a real navigation
  // pushes one. Each entry remembers its depth so the browser's Back and Forward keep it exact.
  useEffect(() => {
    if (screen.kind === "loading") return;
    const url = urlForScreen(screen);
    const previous = syncedScreen.current;
    syncedScreen.current = screen;
    const replace = replaceNext.current;
    replaceNext.current = false;
    if (!url) {
      // Nothing to address this screen with — see `currentEntryPushed`.
      currentEntryPushed.current = false;
      return;
    }
    if (url === window.location.pathname + window.location.search) {
      entryScreens.current[navDepth.current] = screen;
      return;
    }
    if (replace || isSameView(previous, screen)) {
      entryScreens.current[navDepth.current] = screen;
      window.history.replaceState({ goaDepth: navDepth.current }, "", url);
    } else {
      navDepth.current += 1;
      // A new push discards whatever "forward" entries there were.
      entryScreens.current.length = navDepth.current;
      entryScreens.current[navDepth.current] = screen;
      window.history.pushState({ goaDepth: navDepth.current }, "", url);
      currentEntryPushed.current = true;
    }
  }, [screen]);

  useEffect(() => {
    function onPopState(event: PopStateEvent) {
      const depth = (event.state as { goaDepth?: unknown } | null)?.goaDepth;
      navDepth.current = typeof depth === "number" ? depth : 0;
      currentEntryPushed.current = navDepth.current > 0;
      const routed = screenFromUrl(window.location.pathname, window.location.search) ?? { kind: "dashboard" as const };
      entryScreens.current[navDepth.current] = routed;
      setScreen(routed);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Where "Back" leads from the screen on show, and what its button says.
  const backLookup: BackLookup = {
    loggedIn: Boolean(bootstrap?.user),
    groupName: (groupId) => bootstrap?.groups.find((group) => group.id === groupId)?.name ?? null,
    challenge: (challengeId) => {
      const known = selectedChallenge?.id === challengeId ? selectedChallenge : bootstrap?.challenges.find((challenge) => challenge.id === challengeId);
      if (!known) return null;
      return isPersonalChallenge(known, bootstrap?.personalWorkspaceId ?? null)
        ? { groupId: null, personal: true }
        : { groupId: known.groupId ?? null, personal: false };
    },
  };
  const backTarget = backTargetFor(screen, backLookup);
  const backLabelText = (label: BackLabel) => (label.kind === "named" ? label.name : tBack(label.kind));
  const backLabel = backTarget ? backLabelText(backTarget.label) : tc("back");

  /** Moves to `next`, taking the place of the current history entry rather than stacking another. */
  function replaceScreen(next: Screen) {
    replaceNext.current = true;
    setScreen(next);
  }

  /**
   * "Back" always goes *up* to the screen's parent (see `backTargetFor`) — never to wherever the user
   * happened to be, so two screens that link to each other can't bounce. When the parent is exactly
   * the entry behind us, the entry is popped (no duplicate left in history); otherwise the current
   * entry is replaced by the parent.
   */
  function goUp() {
    const target = backTarget?.screen;
    if (!target) return;
    const behind = entryScreens.current[navDepth.current - 1];
    if (currentEntryPushed.current && navDepth.current > 0 && behind && isSameView(behind, target)) window.history.back();
    else replaceScreen(target);
  }

  // Deep links and history navigation set a challenge/admin screen without going
  // through openParticipant/openAdmin; load the detail once when that happens.
  const routedChallengeId =
    screen.kind === "challenge" || screen.kind === "admin" ? screen.challengeId : null;
  const viewerId = bootstrap?.user?.id ?? null;
  useEffect(() => {
    if (!routedChallengeId || !viewerId || detailLoading) return;
    if (selectedChallenge?.id === routedChallengeId) return;
    void loadChallenge(routedChallengeId).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routedChallengeId, viewerId]);

  async function refreshBootstrap(): Promise<BootstrapData> {
    const raw = await apiRequest<BootstrapData | { bootstrap: BootstrapData }>(API_PATHS.bootstrap);
    const data = normalizeBootstrap(raw);
    writeCache(CACHE_KEYS.bootstrap, data);
    setBootstrap(data);
    return data;
  }

  async function loadChallenge(challengeId: Id): Promise<ChallengeDetail> {
    const cached = readCache<{ challenge: ChallengeDetail; entries: Entry[] }>(CACHE_KEYS.challenge(challengeId));
    if (cached) {
      setSelectedChallenge(cached.challenge);
      setEntries(cached.entries);
      setDetailError(null);
    } else {
      setDetailLoading(true);
      setDetailError(null);
    }
    try {
      const [rawChallenge, rawEntries] = await Promise.all([
        apiRequest<ChallengeDetail | { challenge: ChallengeDetail }>(API_PATHS.challenge(challengeId)),
        apiRequest<Entry[] | { entries: Entry[] }>(API_PATHS.entries(challengeId)),
      ]);
      const challenge = normalizeChallenge(rawChallenge);
      const nextEntries = normalizeEntries(rawEntries);
      setSelectedChallenge(challenge);
      setEntries(nextEntries);
      writeCache(CACHE_KEYS.challenge(challengeId), { challenge, entries: nextEntries });
      return challenge;
    } catch (cause) {
      if (!cached) setDetailError(f.error(cause));
      throw cause;
    } finally {
      setDetailLoading(false);
    }
  }

  async function reloadSelected(): Promise<void> {
    if (selectedChallenge) await loadChallenge(selectedChallenge.id);
  }

  async function authenticate(mode: "login" | "register", payload: Record<string, string>) {
    if (!bootstrap) throw new Error(t("bootstrapNotLoaded"));
    await apiRequest(API_PATHS.auth[mode], {
      method: "POST",
      body: payload,
      csrfToken: bootstrap.csrfToken,
    });
    const data = await refreshBootstrap();
    if (!data.user) throw new Error(t("sessionNotCreated"));
    if (pendingInviteToken) {
      try {
        const invitation = await apiRequest<InviteAcceptance>(API_PATHS.invite(pendingInviteToken), {
          method: "POST",
          body: {},
          csrfToken: data.csrfToken,
        });
        setPendingInviteToken(null);
        await refreshBootstrap();
        setScreen({ kind: "invite-success", invitation });
      } catch {
        // Surface the reason (expired, revoked, exhausted) on the invite screen.
        setScreen({ kind: "invite", token: pendingInviteToken });
      }
      return;
    }
    const next = pendingRoute ?? { kind: "dashboard" as const };
    setPendingRoute(null);
    setScreen(next);
  }

  async function logout() {
    if (!bootstrap) return;
    await apiRequest(API_PATHS.auth.logout, { method: "POST", body: {}, csrfToken: bootstrap.csrfToken });
    clearCache();
    const data = await refreshBootstrap();
    setSelectedChallenge(null);
    setEntries([]);
    setPendingRoute(null);
    setResumeTemplateCopy(null);
    setScreen({ kind: "auth", mode: "login" });
    if (data.user) throw new Error(t("sessionNotEnded"));
  }

  async function saveAccount(payload: Record<string, unknown>) {
    if (!bootstrap) return;
    await apiRequest(API_PATHS.account, { method: "PATCH", body: payload, csrfToken: bootstrap.csrfToken });
    await refreshBootstrap();
  }

  async function setNameConsent(challengeId: Id, consent: boolean) {
    if (!bootstrap) return;
    await apiRequest(API_PATHS.nameConsent(challengeId), { method: "PATCH", body: { nameConsent: consent }, csrfToken: bootstrap.csrfToken });
    void refreshBootstrap().catch(() => undefined);
  }

  async function deleteAccountPermanently(password: string) {
    if (!bootstrap) return;
    await apiRequest(API_PATHS.accountDelete, { method: "POST", body: { password }, csrfToken: bootstrap.csrfToken });
    clearCache();
    setSelectedChallenge(null);
    setEntries([]);
    setPendingRoute(null);
    setResumeTemplateCopy(null);
    await refreshBootstrap();
    setScreen({ kind: "auth", mode: "login" });
  }

  async function deactivateAccount() {
    if (!bootstrap) return;
    await apiRequest(API_PATHS.accountDeactivate, { method: "POST", body: {}, csrfToken: bootstrap.csrfToken });
    clearCache();
    setSelectedChallenge(null);
    setEntries([]);
    await refreshBootstrap();
    setScreen({ kind: "auth", mode: "login" });
  }

  async function reactivateAccount() {
    if (!bootstrap) return;
    await apiRequest(API_PATHS.accountReactivate, { method: "POST", body: {}, csrfToken: bootstrap.csrfToken });
    const data = await refreshBootstrap();
    setScreen(data.user ? { kind: "dashboard" } : { kind: "auth", mode: "login" });
  }

  function openParticipant(challengeId: Id, requestedTab?: ParticipantTab) {
    // Land on Results by default — it shows the live standings for an active round
    // and the full showcase once closed. "Today" is one tap away.
    setScreen({ kind: "challenge", challengeId, tab: requestedTab ?? "results" });
  }

  function openAdmin(challengeId: Id, tab: AdminTab = "overview") {
    setScreen({ kind: "admin", challengeId, tab });
  }

  function retryDetail(challengeId: Id) {
    void loadChallenge(challengeId).catch(() => undefined);
  }

  function goToAuthFrom(next: Screen) {
    setPendingRoute(next);
    if (next.kind === "template") setResumeTemplateCopy(next.challengeId);
    setScreen({ kind: "auth", mode: "login" });
  }

  async function createGroup(name: string) {
    if (!bootstrap) return;
    const response = await apiRequest<unknown>(API_PATHS.groups, { method: "POST", body: { name }, csrfToken: bootstrap.csrfToken });
    const groupId = normalizeCreatedId(response);
    const data = await refreshBootstrap();
    const resolvedId = groupId ?? data.groups.find((group) => group.name === name)?.id;
    if (resolvedId) setScreen({ kind: "group", groupId: resolvedId });
  }

  async function updateGroup(groupId: Id, payload: { name: string; description: string; recommendationsEnabled: boolean }) {
    if (!bootstrap) return;
    await apiRequest(API_PATHS.group(groupId), {
      method: "PATCH",
      body: payload,
      csrfToken: bootstrap.csrfToken,
    });
    await refreshBootstrap();
  }

  async function deleteGroup(groupId: Id) {
    if (!bootstrap) return;
    await apiRequest(API_PATHS.group(groupId), { method: "DELETE", csrfToken: bootstrap.csrfToken });
    await refreshBootstrap();
    replaceScreen({ kind: "dashboard" });
  }

  async function leaveGroup(groupId: Id) {
    if (!bootstrap) return;
    await apiRequest(API_PATHS.groupLeave(groupId), {
      method: "POST",
      body: {},
      csrfToken: bootstrap.csrfToken,
    });
    await refreshBootstrap();
    replaceScreen({ kind: "dashboard" });
  }

  async function setMemberRole(groupId: Id, userId: Id, role: "admin" | "participant") {
    if (!bootstrap) return;
    await apiRequest(API_PATHS.groupMember(groupId, userId), {
      method: "PATCH",
      body: { role },
      csrfToken: bootstrap.csrfToken,
    });
    await refreshBootstrap();
  }

  async function respondToMemberRequest(requestId: Id, action: "accept" | "decline") {
    if (!bootstrap) return;
    await apiRequest(
      action === "accept" ? API_PATHS.memberRequestAccept(requestId) : API_PATHS.memberRequestDecline(requestId),
      { method: "POST", body: {}, csrfToken: bootstrap.csrfToken },
    );
    await refreshBootstrap();
  }

  async function cancelMemberRequest(requestId: Id) {
    if (!bootstrap) return;
    await apiRequest(API_PATHS.memberRequestCancel(requestId), { method: "POST", body: {}, csrfToken: bootstrap.csrfToken });
    await refreshBootstrap();
  }

  async function deleteChallenge(challengeId: Id, groupId?: Id) {
    if (!bootstrap) return;
    await apiRequest(API_PATHS.challenge(challengeId), { method: "DELETE", csrfToken: bootstrap.csrfToken });
    await refreshBootstrap();
    replaceScreen(groupId ? { kind: "group", groupId } : { kind: "dashboard" });
  }

  async function deleteCatalogItem(
    path: string,
    back: { kind: "group-catalog"; groupId: Id } | { kind: "personal-catalog" },
  ) {
    if (!bootstrap) return;
    await apiRequest(path, { method: "DELETE", csrfToken: bootstrap.csrfToken });
    await refreshBootstrap();
    replaceScreen(back);
  }

  async function createChallenge(target: { groupId: Id } | { personal: true }, input: ChallengeCreationInput) {
    if (!bootstrap) return;
    const body = {
      recipe: input.recipe,
      ...(input.libraries?.length ? { libraries: input.libraries } : {}),
      title: input.title,
      description: input.description,
      ruleSections: input.ruleSections,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      fields: input.fields,
      items: input.items,
      generateDaily: input.generateDaily,
      expectation: input.expectation === true,
      ...(input.collectsEntryDate !== undefined ? { collectsEntryDate: input.collectsEntryDate } : {}),
      ...(input.answerScope ? { answerScope: input.answerScope } : {}),
      ...(input.sharedEditPolicy ? { sharedEditPolicy: input.sharedEditPolicy } : {}),
      ...(input.itemDates ? { itemDates: true } : {}),
      participantIds: input.participantIds,
    };
    const created = await apiRequest<unknown>(
      "personal" in target ? API_PATHS.personalChallenges : API_PATHS.groupChallenges(target.groupId),
      { method: "POST", csrfToken: bootstrap.csrfToken, body },
    );
    const challengeId = normalizeCreatedId(created);
    if (!challengeId) throw new Error(t("draftWithoutId"));

    await refreshBootstrap();
    // A living list is born active with its items already in — drop the owner
    // straight into the list, not the (mostly empty) admin setup.
    const isList = typeof created === "object" && created !== null
      && (created as { kind?: string }).kind === "list";
    // The finished form gives way to the new challenge — Back never returns to an empty wizard.
    replaceScreen(isList ? { kind: "challenge", challengeId, tab: "results" } : { kind: "admin", challengeId, tab: "overview" });
  }

  async function mutateChallenge(path: string, body: unknown, method: "POST" | "PATCH" | "DELETE" = "POST") {
    if (!bootstrap) return;
    await apiRequest(path, { method, body, csrfToken: bootstrap.csrfToken });
    // The open challenge is what the user is looking at; refresh it before
    // releasing the caller. Dashboard counts can catch up in the background.
    await reloadSelected();
    void refreshBootstrap().catch(() => undefined);
  }

  // Same refresh contract as `mutateChallenge`, but hands the parsed response
  // back — the showcase publish needs the returned share URL.
  async function mutateChallengeReturning<T>(path: string, body: unknown, method: "POST" | "PATCH" | "DELETE" = "POST"): Promise<T | undefined> {
    if (!bootstrap) return undefined;
    const result = await apiRequest<T>(path, { method, body, csrfToken: bootstrap.csrfToken });
    await reloadSelected();
    void refreshBootstrap().catch(() => undefined);
    return result;
  }

  // The caller decides where to go: straight to the copy, or — when the copy had to skip something — after the notice.
  async function duplicateChallenge(payload: { title: string; targetGroupId: Id; mode: "structure" | "structure_and_items" }): Promise<CopyResult> {
    if (!bootstrap || !selectedChallenge) return { challengeId: null, skippedProperties: [] };
    const response = await apiRequest<{ skippedProperties?: SkippedProperty[] }>(API_PATHS.duplicate(selectedChallenge.id), { method: "POST", body: payload, csrfToken: bootstrap.csrfToken });
    const challengeId = normalizeCreatedId(response);
    await refreshBootstrap();
    return { challengeId, skippedProperties: response.skippedProperties ?? [] };
  }

  // A read-only analysis of a pasted JSON list — no refresh, the caller renders it.
  async function previewListImport(body: { json: string; mapping?: Record<string, string> }) {
    if (!bootstrap || !selectedChallenge) throw new Error("no challenge");
    return apiRequest<ImportPreview>(API_PATHS.itemsPreview(selectedChallenge.id), {
      method: "POST",
      body,
      csrfToken: bootstrap.csrfToken,
    });
  }

  async function saveEntry(
    itemId: Id | null,
    values: Record<Id, unknown>,
    entry?: Entry,
    occurredOn?: string | null,
    entryTypeId?: Id,
    checkpointId?: Id | null,
    options?: { expectedUpdatedAt?: string | null },
  ) {
    if (!bootstrap || !selectedChallenge) return;
    // A shared answer says which version it last saw (`null` = "none yet"), so a
    // concurrent change is refused instead of silently overwritten.
    const guard = options && Object.hasOwn(options, "expectedUpdatedAt") ? { expectedUpdatedAt: options.expectedUpdatedAt } : {};
    if (entry) {
      await apiRequest(API_PATHS.entry(entry.id), { method: "PATCH", body: { values, ...guard }, csrfToken: bootstrap.csrfToken });
    } else {
      await apiRequest(API_PATHS.entries(selectedChallenge.id), {
        method: "POST",
        // `null` is meaningful — an entry saved with no date — so only an
        // `undefined` argument drops the key and lets the server assume today.
        body: {
          itemId,
          values,
          ...(occurredOn !== undefined ? { occurredOn } : {}),
          ...(entryTypeId ? { entryTypeId } : {}),
          ...(checkpointId !== undefined ? { checkpointId } : {}),
          ...guard,
        },
        csrfToken: bootstrap.csrfToken,
      });
    }
    // The open challenge is what the user is looking at; refresh it before
    // releasing the caller. Dashboard/group progress counts catch up in the
    // background — otherwise navigating back right after saving shows stale
    // numbers until something else happens to trigger a refresh.
    await reloadSelected();
    void refreshBootstrap().catch(() => undefined);
  }

  if (bootError && !bootstrap) {
    return (
      <main className="grid min-h-screen place-items-center px-5">
        <section className={cx(cardClass, "max-w-lg p-7 text-center")}>
          <Brand />
          <h1 className="mt-6 text-2xl font-light">{t("bootTitle")}</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{bootError}</p>
          <Button className="mt-6" onClick={() => window.location.reload()}>{t("retry")}</Button>
        </section>
      </main>
    );
  }
  if (!bootstrap || screen.kind === "loading") return <LoadingView />;

  if (!bootstrap.user) {
    if (screen.kind === "invite") {
      return <InviteScreen token={screen.token} user={null} csrfToken={bootstrap.csrfToken} onBack={goUp} backLabel={backLabel} onNeedAuth={() => setScreen({ kind: "auth", mode: "login" })} onAccepted={async () => undefined} />;
    }
    if (screen.kind === "templates") {
      return <TemplatesScreen user={null} onOpen={(id) => setScreen({ kind: "template", challengeId: id })} onBack={goUp} backLabel={backLabel} onSignIn={() => goToAuthFrom(screen)} />;
    }
    if (screen.kind === "template") {
      return <TemplateDetailScreen user={null} challengeId={screen.challengeId} groups={[]} csrfToken={bootstrap.csrfToken} onBack={goUp} backLabel={backLabel} onSignIn={() => goToAuthFrom(screen)} onDuplicated={() => undefined} />;
    }
    if (screen.kind === "about") {
      return <AboutScreen onBack={goUp} backLabel={backLabel} />;
    }
    return <AuthScreen initialMode={screen.kind === "auth" ? screen.mode : "login"} invitePending={Boolean(pendingInviteToken)} onAuthenticated={authenticate} onShowInvite={pendingInviteToken ? () => setScreen({ kind: "invite", token: pendingInviteToken }) : undefined} onShowTemplates={() => setScreen({ kind: "templates" })} />;
  }

  const user = bootstrap.user;
  const selectedGroup = screen.kind === "group" || screen.kind === "create-challenge"
    || screen.kind === "catalog-item" || screen.kind === "group-catalog" || screen.kind === "group-trash"
    ? bootstrap.groups.find((group) => group.id === screen.groupId)
    : selectedChallenge ? bootstrap.groups.find((group) => group.id === selectedChallenge.groupId) : undefined;
  const selectedRole = selectedChallenge?.viewerRole ?? selectedGroup?.role;

  let content: ReactNode;
  if (user.deactivated) {
    content = <AccountDeactivatedScreen onReactivate={reactivateAccount} onLogout={logout} />;
  } else if (screen.kind === "account") {
    content = <AccountScreen user={user} challenges={bootstrap.challenges} onBack={goUp} backLabel={backLabel} onSaveProfile={saveAccount} onChangePassword={saveAccount} onSetNameConsent={setNameConsent} onOpenTrash={() => setScreen({ kind: "personal-trash" })} onDeactivate={deactivateAccount} onDeletePermanently={deleteAccountPermanently} />;
  } else if (screen.kind === "personal-trash") {
    content = <PersonalTrashScreen csrfToken={bootstrap.csrfToken} onBack={goUp} backLabel={backLabel} onChanged={() => { void refreshBootstrap(); }} />;
  } else if (screen.kind === "group-trash" && selectedGroup && canManage(selectedGroup.role)) {
    content = (
      <main className="mx-auto max-w-4xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
        <BackButton onClick={goUp} label={backLabel} className="mb-6" />
        <PageHeading title={tTrash("groupTitle")} description={tTrash("groupSubtitle")} />
        <TrashView scope={{ groupId: selectedGroup.id }} csrfToken={bootstrap.csrfToken} onChanged={() => { void refreshBootstrap(); }} />
      </main>
    );
  } else if (screen.kind === "invite") {
    content = <InviteScreen key={screen.token} token={screen.token} user={user} csrfToken={bootstrap.csrfToken} onBack={goUp} backLabel={backLabel} onNeedAuth={() => undefined} onAccepted={async (invitation) => { setPendingInviteToken(null); await refreshBootstrap(); setScreen({ kind: "invite-success", invitation }); }} />;
  } else if (screen.kind === "invite-success") {
    const invitation = screen.invitation;
    content = <InviteAcceptedScreen invitation={invitation} onContinue={() => { if (invitation.challengeId) openParticipant(invitation.challengeId); else setScreen({ kind: "group", groupId: invitation.groupId }); }} />;
  } else if (screen.kind === "templates") {
    content = <TemplatesScreen user={user} onOpen={(id) => setScreen({ kind: "template", challengeId: id })} onBack={goUp} backLabel={backLabel} onSignIn={() => undefined} />;
  } else if (screen.kind === "template") {
    content = <TemplateDetailScreen key={screen.challengeId} user={user} challengeId={screen.challengeId} groups={bootstrap.groups.filter((candidate) => candidate.kind !== "personal")} csrfToken={bootstrap.csrfToken} autoCopy={resumeTemplateCopy === screen.challengeId} onBack={() => { setResumeTemplateCopy(null); goUp(); }} backLabel={backLabel} onSignIn={() => undefined} onDuplicated={async (result) => { setResumeTemplateCopy(null); await refreshBootstrap(); openAdmin(result.challengeId); }} onUnpublished={async () => { await refreshBootstrap(); setScreen({ kind: "templates" }); }} />;
  } else if (screen.kind === "about") {
    content = <AboutScreen onBack={goUp} backLabel={backLabel} />;
  } else if (screen.kind === "group" && selectedGroup) {
    content = <GroupScreen key={selectedGroup.id} group={selectedGroup} challenges={bootstrap.challenges.filter((challenge) => challenge.groupId === selectedGroup.id)} challengeLimit={bootstrap.limits.challengesPerGroup} pendingRequests={selectedGroup.pendingRequests ?? []} onBack={goUp} backLabel={backLabel} onCreateChallenge={() => setScreen({ kind: "create-challenge", groupId: selectedGroup.id })} onOpenChallenge={(id) => openParticipant(id)} onOpenCatalogItem={(itemId) => setScreen({ kind: "catalog-item", groupId: selectedGroup.id, itemId })} onOpenCatalog={() => setScreen({ kind: "group-catalog", groupId: selectedGroup.id })} onCreateInvite={async (payload) => apiRequest<{ token?: string; url?: string }>(API_PATHS.groupInvites(selectedGroup.id), { method: "POST", body: payload, csrfToken: bootstrap.csrfToken })} onInviteByUsername={(username) => apiRequest<GroupInviteResult>(API_PATHS.groupMembers(selectedGroup.id), { method: "POST", body: { username }, csrfToken: bootstrap.csrfToken })} onCancelRequest={cancelMemberRequest} onUpdateGroup={(payload) => updateGroup(selectedGroup.id, payload)} onDeleteGroup={selectedGroup.role === "owner" ? () => deleteGroup(selectedGroup.id) : undefined} onLeaveGroup={selectedGroup.role === "owner" ? undefined : () => leaveGroup(selectedGroup.id)} onSetMemberRole={selectedGroup.role === "owner" ? (userId, role) => setMemberRole(selectedGroup.id, userId, role) : undefined} />;
  } else if (screen.kind === "group-catalog" && selectedGroup) {
    content = <CatalogWorkspaceScreen key={selectedGroup.id} scope={{ groupId: selectedGroup.id }} title={t("groupCatalogTitle", { name: selectedGroup.name })} subtitle={t("groupCatalogSubtitle")} canManage={canManage(selectedGroup.role)} members={selectedGroup.members ?? []} recommendationsEnabled={selectedGroup.recommendationsEnabled !== false} onBack={goUp} backLabel={backLabel} onOpenItem={(itemId) => setScreen({ kind: "catalog-item", groupId: selectedGroup.id, itemId })} />;
  } else if (screen.kind === "catalog-item" && selectedGroup) {
    content = <CatalogItemScreen key={screen.itemId} scope={{ groupId: selectedGroup.id }} recommendationsEnabled={selectedGroup.recommendationsEnabled !== false} detailPath={API_PATHS.groupCatalogItem(screen.groupId, screen.itemId)} itemId={screen.itemId} onBack={goUp} backLabel={backLabel} onOpenChallenge={(id) => openParticipant(id)} editing={canManage(selectedGroup.role) ? { members: selectedGroup.members ?? [] } : undefined} onDelete={canManage(selectedGroup.role) ? () => deleteCatalogItem(API_PATHS.catalogItem(screen.itemId), { kind: "group-catalog", groupId: screen.groupId }) : undefined} />;
  } else if (screen.kind === "personal-space") {
    content = <PersonalSpaceScreen challenges={bootstrap.challenges.filter((challenge) => isPersonalChallenge(challenge, bootstrap.personalWorkspaceId))} onBack={goUp} backLabel={backLabel} onOpenChallenge={(id) => openParticipant(id)} onOpenAdmin={(id) => openAdmin(id)} onCreateChallenge={() => setScreen({ kind: "create-personal-challenge" })} onOpenCatalog={() => setScreen({ kind: "personal-catalog" })} onOpenCatalogItem={(itemId) => setScreen({ kind: "personal-catalog-item", itemId })} onOpenTrash={() => setScreen({ kind: "personal-trash" })} />;
  } else if (screen.kind === "personal-catalog") {
    content = <CatalogWorkspaceScreen key="personal" scope="personal" title={tPersonalCatalog("title")} subtitle={tPersonalCatalog("subtitle")} canManage members={[]} recommendationsEnabled onBack={goUp} backLabel={backLabel} onOpenItem={(itemId) => setScreen({ kind: "personal-catalog-item", itemId })} />;
  } else if (screen.kind === "personal-catalog-item") {
    content = <CatalogItemScreen key={screen.itemId} scope="personal" detailPath={API_PATHS.personalCatalogItem(screen.itemId)} itemId={screen.itemId} onBack={goUp} backLabel={backLabel} onOpenChallenge={(id) => openParticipant(id)} editing={{ members: [] }} onDelete={() => deleteCatalogItem(API_PATHS.personalCatalogItem(screen.itemId), { kind: "personal-catalog" })} />;
  } else if (screen.kind === "create-challenge" && selectedGroup && canManage(selectedGroup.role)) {
    content = <CreateChallengeScreen key={selectedGroup.id} group={selectedGroup} onBack={goUp} backLabel={backLabel} onCreate={(input) => createChallenge({ groupId: selectedGroup.id }, input)} />;
  } else if (screen.kind === "create-personal-challenge") {
    content = <CreateChallengeScreen key="personal" personal onBack={goUp} backLabel={backLabel} onCreate={(input) => createChallenge({ personal: true }, input)} />;
  } else if ((screen.kind === "challenge" || screen.kind === "admin") && (detailLoading || !selectedChallenge || selectedChallenge.id !== screen.challengeId)) {
    content = detailError ? <main className="mx-auto max-w-2xl px-5 py-16"><EmptyState title={t("detailError")} hint={detailError} action={<Button onClick={() => retryDetail(screen.challengeId)}>{t("retry")}</Button>} /></main> : <LoadingView label={tc("loadingChallenge")} />;
  } else if (screen.kind === "challenge" && selectedChallenge) {
    content = <ParticipantChallengeScreen key={selectedChallenge.id} challenge={selectedChallenge} entries={entries} user={user} tab={screen.tab} onTab={(tab) => setScreen({ ...screen, tab })} onBack={goUp} backLabel={backLabel} onAdmin={canManage(selectedRole) ? () => openAdmin(selectedChallenge.id) : undefined} onSaveEntry={saveEntry} onDeleteEntry={(entryId) => mutateChallenge(API_PATHS.entry(entryId), undefined, "DELETE")} onReload={reloadSelected} />;
  } else if (screen.kind === "admin" && selectedChallenge && canManage(selectedRole)) {
    content = <AdminScreen key={selectedChallenge.id} challenge={selectedChallenge} entries={entries} group={selectedGroup} duplicateTargets={bootstrap.groups.filter((candidate) => candidate.id !== selectedChallenge.groupId && candidate.kind !== "personal" && canManage(candidate.role)).map((candidate) => ({ id: candidate.id, name: candidate.name, challengeCount: bootstrap.challenges.filter((item) => item.groupId === candidate.id).length, challengeLimit: bootstrap.limits.challengesPerGroup }))} tab={screen.tab} onTab={(tab) => setScreen({ ...screen, tab })} onBack={goUp} backLabel={backLabel} onSaveBasics={(payload) => mutateChallenge(API_PATHS.challenge(selectedChallenge.id), payload, "PATCH")} onTransition={(status) => mutateChallenge(API_PATHS.transition(selectedChallenge.id), { status })} onDuplicate={duplicateChallenge} onOpenCopy={(challengeId) => openAdmin(challengeId)} isPlatformAdmin={Boolean(user.platformAdmin)} onPublishTemplate={() => mutateChallenge(API_PATHS.challengeTemplate(selectedChallenge.id), {}, "POST")} onUnpublishTemplate={() => mutateChallenge(API_PATHS.challengeTemplate(selectedChallenge.id), undefined, "DELETE")} onDelete={canManage(selectedRole) ? () => deleteChallenge(selectedChallenge.id, selectedGroup?.id) : undefined} onSaveParticipants={(participantIds) => mutateChallenge(API_PATHS.participants(selectedChallenge.id), { replace: true, participantIds })} onSaveFields={(entryTypeId, fields) => mutateChallenge(API_PATHS.fields(selectedChallenge.id), { ...(entryTypeId ? { entryTypeId } : {}), replace: true, archiveMissing: true, fields })} onSaveEntryTypeVisibility={(entryTypeId, visibilityPolicy) => mutateChallenge(API_PATHS.entryType(selectedChallenge.id, entryTypeId), { visibilityPolicy }, "PATCH")} onSetExpectation={(enabled) => mutateChallenge(API_PATHS.expectation(selectedChallenge.id), { enabled }, "PATCH")} onSaveEntryDate={(collectsEntryDate) => mutateChallenge(API_PATHS.challenge(selectedChallenge.id), { collectsEntryDate }, "PATCH")} onAddSharedResponse={(payload) => mutateChallenge(API_PATHS.entryTypes(selectedChallenge.id), payload)} onRemoveEntryType={(entryTypeId, confirmed) => mutateChallenge(`${API_PATHS.entryType(selectedChallenge.id, entryTypeId)}${[confirmed.archiveMetrics ? "archiveMetrics=1" : "", confirmed.deleteAnswers ? "deleteAnswers=1" : ""].filter(Boolean).map((part, index) => `${index ? "&" : "?"}${part}`).join("")}`, undefined, "DELETE")} onSaveSharedPolicy={(entryTypeId, sharedEditPolicy) => mutateChallenge(API_PATHS.entryType(selectedChallenge.id, entryTypeId), { sharedEditPolicy }, "PATCH")} onAddItems={(payload) => mutateChallenge(API_PATHS.items(selectedChallenge.id), payload)} onLinkLibrary={(spec) => mutateChallenge(API_PATHS.challengeLibraries(selectedChallenge.id), spec)} onUnlinkLibrary={(libraryId) => mutateChallenge(API_PATHS.challengeLibrary(selectedChallenge.id, libraryId), undefined, "DELETE")} onUpdateItem={(itemId, payload) => mutateChallenge(API_PATHS.item(selectedChallenge.id, itemId), payload, "PATCH")} onArchiveItem={(itemId) => mutateChallenge(API_PATHS.item(selectedChallenge.id, itemId), undefined, "DELETE")} onPreviewImport={previewListImport} onSaveCheckpoints={(checkpoints) => mutateChallenge(API_PATHS.checkpoints(selectedChallenge.id), { checkpoints })} onAssignCheckpointItems={(assignments) => mutateChallenge(API_PATHS.itemsAssign(selectedChallenge.id), { assignments })} onAddMetric={(payload) => mutateChallenge(API_PATHS.metrics(selectedChallenge.id), payload)} onUpdateMetric={(metricId, payload) => mutateChallenge(API_PATHS.metric(selectedChallenge.id, metricId), payload, "PATCH")} onDeleteMetric={(metricId) => mutateChallenge(API_PATHS.metric(selectedChallenge.id, metricId), undefined, "DELETE")} onSaveResult={(payload) => mutateChallengeReturning<{ published?: boolean }>(API_PATHS.results(selectedChallenge.id), payload)} onPublishResult={(payload) => mutateChallengeReturning<{ url?: string | null; publishedAt?: string; anonymized?: boolean }>(API_PATHS.resultsPublish(selectedChallenge.id), payload)} onUnpublishResult={() => mutateChallenge(API_PATHS.results(selectedChallenge.id), undefined, "DELETE")} csrfToken={bootstrap.csrfToken} onArchiveChanged={() => { void reloadSelected(); void refreshBootstrap(); }} />;
  } else if (screen.kind === "admin" || screen.kind === "create-challenge") {
    content = <main className="mx-auto max-w-2xl px-5 py-16"><EmptyState title={t("adminUnavailableTitle")} action={<Button onClick={() => setScreen({ kind: "dashboard" })}>{t("backToStart")}</Button>} /></main>;
  } else {
    content = <DashboardScreen user={user} groups={bootstrap.groups} challenges={bootstrap.challenges} personalWorkspaceId={bootstrap.personalWorkspaceId} limits={bootstrap.limits} csrfToken={bootstrap.csrfToken} onOpenGroup={(groupId) => setScreen({ kind: "group", groupId })} onOpenChallenge={(id) => openParticipant(id)} onOpenAdmin={(id) => openAdmin(id)} onCreateGroup={createGroup} onCreatePersonalChallenge={() => setScreen({ kind: "create-personal-challenge" })} onOpenTemplates={() => setScreen({ kind: "templates" })} onChanged={() => { void refreshBootstrap(); }} />;
  }

  return (
    <CsrfProvider token={bootstrap.csrfToken}>
    <div className="flex min-h-screen flex-col bg-[var(--canvas)] text-[var(--ink)]">
      <AppHeader user={user} notifications={bootstrap.memberRequests} onHome={() => setScreen({ kind: "dashboard" })} onAccount={() => setScreen({ kind: "account" })} onOpenPersonalSpace={() => setScreen({ kind: "personal-space" })} onOpenTemplates={() => setScreen({ kind: "templates" })} onOpenAbout={() => setScreen({ kind: "about" })} onLogout={logout} onAcceptRequest={(id) => respondToMemberRequest(id, "accept")} onDeclineRequest={(id) => respondToMemberRequest(id, "decline")} />
      <div className="flex-1">{content}</div>
    </div>
    </CsrfProvider>
  );
}
