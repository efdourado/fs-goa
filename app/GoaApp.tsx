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
import { PersonalCatalogScreen } from "./goa/screens/personal-catalog";
import { PersonalSpaceScreen } from "./goa/screens/personal-space";
import { PersonalTrashScreen } from "./goa/screens/personal-trash";
import { TrashView } from "./goa/trash-view";
import { TemplateDetailScreen, TemplatesScreen } from "./goa/screens/templates";
import { screenFromUrl, urlForScreen } from "./goa/navigation";
import type {
  AdminTab,
  BootstrapData,
  ChallengeCreationInput,
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
import { AppHeader, Brand, Button, cardClass, cx, EmptyState, LoadingView, PageHeading } from "./goa/ui";
import { canManage, isPersonalChallenge, slugify } from "./goa/utils";

export default function GoaApp() {
  const t = useTranslations("app");
  const tc = useTranslations("common");
  const tTrash = useTranslations("trash");
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

  // Keep the address bar in step with the current screen so every view is
  // shareable and the browser's back button lands where the user expects.
  useEffect(() => {
    if (screen.kind === "loading") return;
    const url = urlForScreen(screen);
    if (!url || url === window.location.pathname + window.location.search) return;
    window.history.pushState(null, "", url);
  }, [screen]);

  useEffect(() => {
    function onPopState() {
      const routed = screenFromUrl(window.location.pathname, window.location.search);
      setScreen(routed ?? { kind: "dashboard" });
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

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

  async function updateGroup(groupId: Id, payload: { name: string; description: string }) {
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
    setScreen({ kind: "dashboard" });
  }

  async function leaveGroup(groupId: Id) {
    if (!bootstrap) return;
    await apiRequest(API_PATHS.groupLeave(groupId), {
      method: "POST",
      body: {},
      csrfToken: bootstrap.csrfToken,
    });
    await refreshBootstrap();
    setScreen({ kind: "dashboard" });
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
    setScreen(groupId ? { kind: "group", groupId } : { kind: "dashboard" });
  }

  async function deleteCatalogItem(
    path: string,
    back: { kind: "group"; groupId: Id } | { kind: "personal-catalog" },
  ) {
    if (!bootstrap) return;
    await apiRequest(path, { method: "DELETE", csrfToken: bootstrap.csrfToken });
    await refreshBootstrap();
    setScreen(back);
  }

  async function createChallenge(target: { groupId: Id } | { personal: true }, input: ChallengeCreationInput) {
    if (!bootstrap) return;
    const body = {
      recipe: input.recipe,
      title: input.title,
      description: input.description,
      ruleSections: input.ruleSections,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      fields: input.fields,
      items: input.items,
      generateDaily: input.generateDaily,
      expectation: input.expectation === true,
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
    if (isList) openParticipant(challengeId);
    else openAdmin(challengeId);
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

  async function duplicateChallenge(payload: { title: string; targetGroupId: Id }) {
    if (!bootstrap || !selectedChallenge) return;
    const response = await apiRequest<unknown>(API_PATHS.duplicate(selectedChallenge.id), { method: "POST", body: payload, csrfToken: bootstrap.csrfToken });
    const challengeId = normalizeCreatedId(response);
    await refreshBootstrap();
    if (challengeId) openAdmin(challengeId);
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
  ) {
    if (!bootstrap || !selectedChallenge) return;
    if (entry) {
      await apiRequest(API_PATHS.entry(entry.id), { method: "PATCH", body: { values }, csrfToken: bootstrap.csrfToken });
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

  async function exportCsv() {
    if (!selectedChallenge) return;
    const response = await fetch(API_PATHS.exportEntries(selectedChallenge.id), { credentials: "same-origin", headers: { Accept: "text/csv" } });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || t("exportFailed"));
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slugify(selectedChallenge.title)}-${t("exportFilename")}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
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
      return <InviteScreen token={screen.token} user={null} csrfToken={bootstrap.csrfToken} onBack={() => setScreen({ kind: "auth", mode: "login" })} onNeedAuth={() => setScreen({ kind: "auth", mode: "login" })} onAccepted={async () => undefined} />;
    }
    if (screen.kind === "templates") {
      return <TemplatesScreen user={null} manageableChallenges={[]} csrfToken={bootstrap.csrfToken} onOpen={(id) => setScreen({ kind: "template", challengeId: id })} onBack={() => setScreen({ kind: "auth", mode: "login" })} onSignIn={() => goToAuthFrom(screen)} onChanged={() => undefined} />;
    }
    if (screen.kind === "template") {
      return <TemplateDetailScreen user={null} challengeId={screen.challengeId} groups={[]} csrfToken={bootstrap.csrfToken} onBack={() => setScreen({ kind: "templates" })} onSignIn={() => goToAuthFrom(screen)} onDuplicated={() => undefined} />;
    }
    if (screen.kind === "about") {
      return <AboutScreen onBack={() => setScreen({ kind: "auth", mode: "login" })} />;
    }
    return <AuthScreen initialMode={screen.kind === "auth" ? screen.mode : "login"} invitePending={Boolean(pendingInviteToken)} onAuthenticated={authenticate} onShowInvite={pendingInviteToken ? () => setScreen({ kind: "invite", token: pendingInviteToken }) : undefined} onShowTemplates={() => setScreen({ kind: "templates" })} />;
  }

  const user = bootstrap.user;
  const selectedGroup = screen.kind === "group" || screen.kind === "create-challenge"
    || screen.kind === "catalog-item" || screen.kind === "group-trash"
    ? bootstrap.groups.find((group) => group.id === screen.groupId)
    : selectedChallenge ? bootstrap.groups.find((group) => group.id === selectedChallenge.groupId) : undefined;
  const selectedRole = selectedChallenge?.viewerRole ?? selectedGroup?.role;

  let content: ReactNode;
  if (user.deactivated) {
    content = <AccountDeactivatedScreen onReactivate={reactivateAccount} onLogout={logout} />;
  } else if (screen.kind === "account") {
    content = <AccountScreen user={user} onBack={() => setScreen({ kind: "dashboard" })} onSaveProfile={saveAccount} onChangePassword={saveAccount} onDeactivate={deactivateAccount} onDeletePermanently={deleteAccountPermanently} />;
  } else if (screen.kind === "personal-trash") {
    content = <PersonalTrashScreen csrfToken={bootstrap.csrfToken} onBack={() => setScreen({ kind: "personal-space" })} onChanged={() => { void refreshBootstrap(); }} />;
  } else if (screen.kind === "group-trash" && selectedGroup && canManage(selectedGroup.role)) {
    content = (
      <main className="mx-auto max-w-4xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
        <button className="mb-6 text-sm text-[var(--muted)] hover:text-[var(--ink)]" type="button" onClick={() => setScreen({ kind: "group", groupId: selectedGroup.id })}>{t("backToStart")}</button>
        <PageHeading title={tTrash("groupTitle")} description={tTrash("groupSubtitle")} />
        <TrashView scope={{ groupId: selectedGroup.id }} csrfToken={bootstrap.csrfToken} onChanged={() => { void refreshBootstrap(); }} />
      </main>
    );
  } else if (screen.kind === "invite") {
    content = <InviteScreen key={screen.token} token={screen.token} user={user} csrfToken={bootstrap.csrfToken} onBack={() => setScreen({ kind: "dashboard" })} onNeedAuth={() => undefined} onAccepted={async (invitation) => { setPendingInviteToken(null); await refreshBootstrap(); setScreen({ kind: "invite-success", invitation }); }} />;
  } else if (screen.kind === "invite-success") {
    const invitation = screen.invitation;
    content = <InviteAcceptedScreen invitation={invitation} onContinue={() => { if (invitation.challengeId) openParticipant(invitation.challengeId); else setScreen({ kind: "group", groupId: invitation.groupId }); }} />;
  } else if (screen.kind === "templates") {
    content = <TemplatesScreen user={user} manageableChallenges={bootstrap.challenges.filter((challenge) => canManage(challenge.viewerRole))} csrfToken={bootstrap.csrfToken} onOpen={(id) => setScreen({ kind: "template", challengeId: id })} onBack={() => setScreen({ kind: "dashboard" })} onSignIn={() => undefined} onChanged={() => { void refreshBootstrap(); }} />;
  } else if (screen.kind === "template") {
    content = <TemplateDetailScreen key={screen.challengeId} user={user} challengeId={screen.challengeId} groups={bootstrap.groups.filter((candidate) => candidate.kind !== "personal")} csrfToken={bootstrap.csrfToken} autoCopy={resumeTemplateCopy === screen.challengeId} onBack={() => { setResumeTemplateCopy(null); setScreen({ kind: "templates" }); }} onSignIn={() => undefined} onDuplicated={async (result) => { setResumeTemplateCopy(null); await refreshBootstrap(); openAdmin(result.challengeId); }} />;
  } else if (screen.kind === "about") {
    content = <AboutScreen onBack={() => setScreen({ kind: "dashboard" })} />;
  } else if (screen.kind === "group" && selectedGroup) {
    content = <GroupScreen key={selectedGroup.id} group={selectedGroup} challenges={bootstrap.challenges.filter((challenge) => challenge.groupId === selectedGroup.id)} challengeLimit={bootstrap.limits.challengesPerGroup} pendingRequests={selectedGroup.pendingRequests ?? []} onBack={() => setScreen({ kind: "dashboard" })} onCreateChallenge={() => setScreen({ kind: "create-challenge", groupId: selectedGroup.id })} onOpenChallenge={(id) => openParticipant(id)} onOpenCatalogItem={(itemId) => setScreen({ kind: "catalog-item", groupId: selectedGroup.id, itemId })} onCreateInvite={async (payload) => apiRequest<{ token?: string; url?: string }>(API_PATHS.groupInvites(selectedGroup.id), { method: "POST", body: payload, csrfToken: bootstrap.csrfToken })} onInviteByUsername={(username) => apiRequest<GroupInviteResult>(API_PATHS.groupMembers(selectedGroup.id), { method: "POST", body: { username }, csrfToken: bootstrap.csrfToken })} onCancelRequest={cancelMemberRequest} onUpdateGroup={(payload) => updateGroup(selectedGroup.id, payload)} onDeleteGroup={selectedGroup.role === "owner" ? () => deleteGroup(selectedGroup.id) : undefined} onLeaveGroup={selectedGroup.role === "owner" ? undefined : () => leaveGroup(selectedGroup.id)} onSetMemberRole={selectedGroup.role === "owner" ? (userId, role) => setMemberRole(selectedGroup.id, userId, role) : undefined} onOpenTrash={canManage(selectedGroup.role) ? () => setScreen({ kind: "group-trash", groupId: selectedGroup.id }) : undefined} />;
  } else if (screen.kind === "catalog-item" && selectedGroup) {
    content = <CatalogItemScreen key={screen.itemId} detailPath={API_PATHS.groupCatalogItem(screen.groupId, screen.itemId)} itemId={screen.itemId} onBack={() => setScreen({ kind: "group", groupId: screen.groupId })} onOpenChallenge={(id) => openParticipant(id)} onDelete={canManage(selectedGroup.role) ? () => deleteCatalogItem(API_PATHS.catalogItem(screen.itemId), { kind: "group", groupId: screen.groupId }) : undefined} />;
  } else if (screen.kind === "personal-space") {
    content = <PersonalSpaceScreen challenges={bootstrap.challenges.filter((challenge) => isPersonalChallenge(challenge, bootstrap.personalWorkspaceId))} onBack={() => setScreen({ kind: "dashboard" })} onOpenChallenge={(id) => openParticipant(id)} onOpenAdmin={(id) => openAdmin(id)} onCreateChallenge={() => setScreen({ kind: "create-personal-challenge" })} onOpenCatalog={() => setScreen({ kind: "personal-catalog" })} onOpenTrash={() => setScreen({ kind: "personal-trash" })} />;
  } else if (screen.kind === "personal-catalog") {
    content = <PersonalCatalogScreen onBack={() => setScreen({ kind: "personal-space" })} onOpenItem={(itemId) => setScreen({ kind: "personal-catalog-item", itemId })} />;
  } else if (screen.kind === "personal-catalog-item") {
    content = <CatalogItemScreen key={screen.itemId} detailPath={API_PATHS.personalCatalogItem(screen.itemId)} itemId={screen.itemId} onBack={() => setScreen({ kind: "personal-catalog" })} onOpenChallenge={(id) => openParticipant(id)} onDelete={() => deleteCatalogItem(API_PATHS.personalCatalogItem(screen.itemId), { kind: "personal-catalog" })} />;
  } else if (screen.kind === "create-challenge" && selectedGroup && canManage(selectedGroup.role)) {
    content = <CreateChallengeScreen key={selectedGroup.id} group={selectedGroup} onBack={() => setScreen({ kind: "group", groupId: selectedGroup.id })} onCreate={(input) => createChallenge({ groupId: selectedGroup.id }, input)} />;
  } else if (screen.kind === "create-personal-challenge") {
    content = <CreateChallengeScreen key="personal" personal onBack={() => setScreen({ kind: "personal-space" })} onCreate={(input) => createChallenge({ personal: true }, input)} />;
  } else if ((screen.kind === "challenge" || screen.kind === "admin") && (detailLoading || !selectedChallenge || selectedChallenge.id !== screen.challengeId)) {
    content = detailError ? <main className="mx-auto max-w-2xl px-5 py-16"><EmptyState title={t("detailError")} description={detailError} action={<Button onClick={() => retryDetail(screen.challengeId)}>{t("retry")}</Button>} /></main> : <LoadingView label={tc("loadingChallenge")} />;
  } else if (screen.kind === "challenge" && selectedChallenge) {
    content = <ParticipantChallengeScreen key={selectedChallenge.id} challenge={selectedChallenge} entries={entries} user={user} tab={screen.tab} onTab={(tab) => setScreen({ ...screen, tab })} onBack={() => selectedGroup ? setScreen({ kind: "group", groupId: selectedGroup.id }) : isPersonalChallenge(selectedChallenge, bootstrap.personalWorkspaceId) ? setScreen({ kind: "personal-space" }) : setScreen({ kind: "dashboard" })} onAdmin={canManage(selectedRole) ? () => openAdmin(selectedChallenge.id) : undefined} onSaveEntry={saveEntry} onDeleteEntry={(entryId) => mutateChallenge(API_PATHS.entry(entryId), undefined, "DELETE")} onSetNameConsent={(nameConsent) => mutateChallenge(API_PATHS.nameConsent(selectedChallenge.id), { nameConsent }, "PATCH")} />;
  } else if (screen.kind === "admin" && selectedChallenge && canManage(selectedRole)) {
    content = <AdminScreen key={selectedChallenge.id} challenge={selectedChallenge} entries={entries} group={selectedGroup} duplicateTargets={bootstrap.groups.filter((candidate) => candidate.id !== selectedChallenge.groupId && candidate.kind !== "personal" && canManage(candidate.role)).map((candidate) => ({ id: candidate.id, name: candidate.name, challengeCount: bootstrap.challenges.filter((item) => item.groupId === candidate.id).length, challengeLimit: bootstrap.limits.challengesPerGroup }))} tab={screen.tab} onTab={(tab) => setScreen({ ...screen, tab })} onBack={() => selectedGroup ? setScreen({ kind: "group", groupId: selectedGroup.id }) : isPersonalChallenge(selectedChallenge, bootstrap.personalWorkspaceId) ? setScreen({ kind: "personal-space" }) : setScreen({ kind: "dashboard" })} onViewParticipant={() => setScreen({ kind: "challenge", challengeId: selectedChallenge.id, tab: "results" })} onSaveBasics={(payload) => mutateChallenge(API_PATHS.challenge(selectedChallenge.id), payload, "PATCH")} onTransition={(status) => mutateChallenge(API_PATHS.transition(selectedChallenge.id), { status })} onDuplicate={duplicateChallenge} onDelete={canManage(selectedRole) ? () => deleteChallenge(selectedChallenge.id, selectedGroup?.id) : undefined} onSaveParticipants={(participantIds) => mutateChallenge(API_PATHS.participants(selectedChallenge.id), { replace: true, participantIds })} onSaveFields={(entryTypeId, fields) => mutateChallenge(API_PATHS.fields(selectedChallenge.id), { ...(entryTypeId ? { entryTypeId } : {}), replace: true, archiveMissing: true, fields })} onSaveEntryTypeVisibility={(entryTypeId, visibilityPolicy) => mutateChallenge(API_PATHS.entryType(selectedChallenge.id, entryTypeId), { visibilityPolicy }, "PATCH")} onSetExpectation={(enabled) => mutateChallenge(API_PATHS.expectation(selectedChallenge.id), { enabled }, "PATCH")} onAddItems={(payload) => mutateChallenge(API_PATHS.items(selectedChallenge.id), payload)} onUpdateItem={(itemId, payload) => mutateChallenge(API_PATHS.item(selectedChallenge.id, itemId), payload, "PATCH")} onArchiveItem={(itemId) => mutateChallenge(API_PATHS.item(selectedChallenge.id, itemId), undefined, "DELETE")} onPreviewImport={previewListImport} onSaveCheckpoints={(checkpoints) => mutateChallenge(API_PATHS.checkpoints(selectedChallenge.id), { checkpoints })} onAssignCheckpointItems={(assignments) => mutateChallenge(API_PATHS.itemsAssign(selectedChallenge.id), { assignments })} onPatchEntry={(entryId, values, reason) => mutateChallenge(API_PATHS.entry(entryId), { values, reason }, "PATCH")} onDeleteEntry={(entryId, reason) => mutateChallenge(API_PATHS.entry(entryId), { reason }, "DELETE")} onExport={exportCsv} onAddMetric={(payload) => mutateChallenge(API_PATHS.metrics(selectedChallenge.id), payload)} onUpdateMetric={(metricId, payload) => mutateChallenge(API_PATHS.metric(selectedChallenge.id, metricId), payload, "PATCH")} onDeleteMetric={(metricId) => mutateChallenge(API_PATHS.metric(selectedChallenge.id, metricId), undefined, "DELETE")} onSaveResult={(payload) => mutateChallengeReturning<{ unpublished?: boolean }>(API_PATHS.results(selectedChallenge.id), payload)} onPublishResult={(payload) => mutateChallengeReturning<{ url?: string | null; publishedAt?: string; anonymized?: boolean }>(API_PATHS.resultsPublish(selectedChallenge.id), payload)} onUnpublishResult={() => mutateChallenge(API_PATHS.results(selectedChallenge.id), undefined, "DELETE")} onReorderBlocks={(blocks) => mutateChallenge(API_PATHS.resultBlocks(selectedChallenge.id), { blocks }, "PATCH")} csrfToken={bootstrap.csrfToken} onArchiveChanged={() => { void reloadSelected(); void refreshBootstrap(); }} />;
  } else if (screen.kind === "admin" || screen.kind === "create-challenge") {
    content = <main className="mx-auto max-w-2xl px-5 py-16"><EmptyState title={t("adminUnavailableTitle")} description={t("adminUnavailableBody")} action={<Button onClick={() => setScreen({ kind: "dashboard" })}>{t("backToStart")}</Button>} /></main>;
  } else {
    content = <DashboardScreen user={user} groups={bootstrap.groups} challenges={bootstrap.challenges} personalWorkspaceId={bootstrap.personalWorkspaceId} limits={bootstrap.limits} onOpenGroup={(groupId) => setScreen({ kind: "group", groupId })} onOpenChallenge={(id) => openParticipant(id)} onOpenAdmin={(id) => openAdmin(id)} onCreateGroup={createGroup} />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--canvas)] text-[var(--ink)]">
      <AppHeader user={user} notifications={bootstrap.memberRequests} onHome={() => setScreen({ kind: "dashboard" })} onAccount={() => setScreen({ kind: "account" })} onOpenPersonalSpace={() => setScreen({ kind: "personal-space" })} onOpenTemplates={() => setScreen({ kind: "templates" })} onOpenAbout={() => setScreen({ kind: "about" })} onLogout={logout} onAcceptRequest={(id) => respondToMemberRequest(id, "accept")} onDeclineRequest={(id) => respondToMemberRequest(id, "decline")} />
      <div className="flex-1">{content}</div>
    </div>
  );
}
