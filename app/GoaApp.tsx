"use client";

import { type ReactNode, useEffect, useState } from "react";

import {
  API_PATHS,
  apiRequest,
  errorMessage,
  normalizeBootstrap,
  normalizeChallenge,
  normalizeCreatedId,
  normalizeEntries,
} from "./goa/api";
import { AccountScreen } from "./goa/screens/account";
import { AdminScreen } from "./goa/screens/admin";
import { AuthScreen } from "./goa/screens/auth";
import { CreateChallengeScreen } from "./goa/screens/create-challenge";
import { DashboardScreen } from "./goa/screens/dashboard";
import { GroupScreen } from "./goa/screens/group";
import { InviteAcceptedScreen, InviteScreen } from "./goa/screens/invite";
import { ParticipantChallengeScreen } from "./goa/screens/participant-challenge";
import { ResetPasswordScreen } from "./goa/screens/reset-password";
import { TemplateDetailScreen, TemplatesScreen } from "./goa/screens/templates";
import { screenFromUrl, urlForScreen } from "./goa/navigation";
import type {
  AdminTab,
  BootstrapData,
  ChallengeCreationInput,
  ChallengeDetail,
  Entry,
  GroupMemberResult,
  Id,
  InviteAcceptance,
  ParticipantTab,
  Screen,
} from "./goa/types";
import { CACHE_KEYS, clearCache, readCache, writeCache } from "./goa/cache";
import { AppHeader, Brand, Button, cardClass, cx, EmptyState, LoadingView } from "./goa/ui";
import { canManage, slugify } from "./goa/utils";

export default function GoaApp() {
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
    const params = new URLSearchParams(window.location.search);
    const resetToken = params.get("reset");
    const queryToken = params.get("invite");
    const pathMatch = window.location.pathname.match(/\/invites?\/([^/]+)/);
    const inviteToken = queryToken || (pathMatch ? decodeURIComponent(pathMatch[1]) : null);
    const routed = screenFromUrl(window.location.pathname, window.location.search);

    const resolveScreen = (data: BootstrapData): Screen => {
      if (resetToken) return { kind: "reset", token: resetToken };
      if (inviteToken) return { kind: "invite", token: inviteToken };
      if (!data.user) return { kind: "auth", mode: "login" };
      return routed && routed.kind !== "invite" && routed.kind !== "reset" ? routed : { kind: "dashboard" };
    };

    // Paint from the last known bootstrap so the first screen is instant, then
    // revalidate against the database in the background.
    const cached = readCache<BootstrapData>(CACHE_KEYS.bootstrap);
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
        if (!data.user && !resetToken && !inviteToken && routed && routed.kind !== "dashboard") {
          setPendingRoute(routed);
        }
        setScreen(resolveScreen(data));
      })
      .catch((cause: unknown) => {
        if (!active || (cause instanceof DOMException && cause.name === "AbortError")) return;
        if (!cached) setBootError(errorMessage(cause));
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
  useEffect(() => {
    if (!routedChallengeId || !bootstrap?.user || detailLoading) return;
    if (selectedChallenge?.id === routedChallengeId) return;
    void loadChallenge(routedChallengeId).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routedChallengeId, bootstrap?.user]);

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
      if (!cached) setDetailError(errorMessage(cause));
      throw cause;
    } finally {
      setDetailLoading(false);
    }
  }

  async function reloadSelected(): Promise<void> {
    if (selectedChallenge) await loadChallenge(selectedChallenge.id);
  }

  async function authenticate(mode: "login" | "register", payload: Record<string, string>) {
    if (!bootstrap) throw new Error("O bootstrap de segurança ainda não foi carregado.");
    await apiRequest(API_PATHS.auth[mode], {
      method: "POST",
      body: payload,
      csrfToken: bootstrap.csrfToken,
    });
    const data = await refreshBootstrap();
    if (!data.user) throw new Error("A sessão não foi criada. Tente novamente.");
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
    if (data.user) throw new Error("Não foi possível encerrar a sessão.");
  }

  async function forgotPassword(email: string) {
    await apiRequest(API_PATHS.auth.forgot, { method: "POST", body: { email }, csrfToken: bootstrap?.csrfToken });
  }

  async function completeReset() {
    window.history.replaceState({}, "", window.location.pathname);
    const data = await refreshBootstrap();
    setScreen(data.user ? { kind: "dashboard" } : { kind: "auth", mode: "login" });
  }

  async function saveAccount(payload: Record<string, unknown>) {
    if (!bootstrap) return;
    await apiRequest(API_PATHS.account, { method: "PATCH", body: payload, csrfToken: bootstrap.csrfToken });
    await refreshBootstrap();
  }

  function openParticipant(challengeId: Id, requestedTab?: ParticipantTab) {
    const summary = bootstrap?.challenges.find((challenge) => challenge.id === challengeId);
    const tab = requestedTab ?? (summary?.status === "closed" ? "results" : "today");
    setScreen({ kind: "challenge", challengeId, tab });
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

  async function deleteChallenge(challengeId: Id, groupId?: Id) {
    if (!bootstrap) return;
    await apiRequest(API_PATHS.challenge(challengeId), { method: "DELETE", csrfToken: bootstrap.csrfToken });
    await refreshBootstrap();
    setScreen(groupId ? { kind: "group", groupId } : { kind: "dashboard" });
  }

  async function createChallenge(groupId: Id, input: ChallengeCreationInput) {
    if (!bootstrap) return;
    const created = await apiRequest<unknown>(API_PATHS.groupChallenges(groupId), {
      method: "POST",
      csrfToken: bootstrap.csrfToken,
      body: {
        template: input.template,
        title: input.title,
        description: input.description,
        ruleSections: input.ruleSections,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        submissionMode: input.submissionMode,
        fields: input.fields,
        items: input.items,
        generateDaily: input.generateDaily,
        participantIds: input.participantIds,
      },
    });
    const challengeId = normalizeCreatedId(created);
    if (!challengeId) throw new Error("O servidor criou o rascunho sem retornar seu identificador.");

    await refreshBootstrap();
    openAdmin(challengeId);
  }

  async function mutateChallenge(path: string, body: unknown, method: "POST" | "PATCH" = "POST") {
    if (!bootstrap) return;
    await apiRequest(path, { method, body, csrfToken: bootstrap.csrfToken });
    // The open challenge is what the user is looking at; refresh it before
    // releasing the caller. Dashboard counts can catch up in the background.
    await reloadSelected();
    void refreshBootstrap().catch(() => undefined);
  }

  async function duplicateChallenge(payload: { title: string; targetGroupId: Id }) {
    if (!bootstrap || !selectedChallenge) return;
    const response = await apiRequest<unknown>(API_PATHS.duplicate(selectedChallenge.id), { method: "POST", body: payload, csrfToken: bootstrap.csrfToken });
    const challengeId = normalizeCreatedId(response);
    await refreshBootstrap();
    if (challengeId) openAdmin(challengeId);
  }

  async function saveEntry(itemId: Id | null, values: Record<Id, unknown>, entry?: Entry) {
    if (!bootstrap || !selectedChallenge) return;
    if (entry) {
      await apiRequest(API_PATHS.entry(entry.id), { method: "PATCH", body: { values }, csrfToken: bootstrap.csrfToken });
    } else {
      await apiRequest(API_PATHS.entries(selectedChallenge.id), { method: "POST", body: { itemId, values }, csrfToken: bootstrap.csrfToken });
    }
    await reloadSelected();
  }

  async function exportCsv() {
    if (!selectedChallenge) return;
    const response = await fetch(API_PATHS.exportEntries(selectedChallenge.id), { credentials: "same-origin", headers: { Accept: "text/csv" } });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || "Não foi possível exportar os registros.");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slugify(selectedChallenge.title)}-registros.csv`;
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
          <h1 className="mt-6 text-2xl font-light">Não foi possível abrir o Goa</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{bootError}</p>
          <Button className="mt-6" onClick={() => window.location.reload()}>Tentar novamente</Button>
        </section>
      </main>
    );
  }
  if (!bootstrap || screen.kind === "loading") return <LoadingView />;

  if (screen.kind === "reset") {
    return <ResetPasswordScreen token={screen.token} onDone={completeReset} onCancel={() => { window.history.replaceState({}, "", window.location.pathname); setScreen({ kind: "auth", mode: "login" }); }} />;
  }

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
    return <AuthScreen initialMode={screen.kind === "auth" ? screen.mode : "login"} invitePending={Boolean(pendingInviteToken)} onAuthenticated={authenticate} onForgot={forgotPassword} onShowInvite={pendingInviteToken ? () => setScreen({ kind: "invite", token: pendingInviteToken }) : undefined} onShowTemplates={() => setScreen({ kind: "templates" })} />;
  }

  const user = bootstrap.user;
  const selectedGroup = screen.kind === "group" || screen.kind === "create-challenge"
    ? bootstrap.groups.find((group) => group.id === screen.groupId)
    : selectedChallenge ? bootstrap.groups.find((group) => group.id === selectedChallenge.groupId) : undefined;
  const selectedRole = selectedChallenge?.viewerRole ?? selectedGroup?.role;

  let content: ReactNode;
  if (screen.kind === "account") {
    content = <AccountScreen user={user} onBack={() => setScreen({ kind: "dashboard" })} onSaveProfile={saveAccount} onChangePassword={saveAccount} />;
  } else if (screen.kind === "invite") {
    content = <InviteScreen key={screen.token} token={screen.token} user={user} csrfToken={bootstrap.csrfToken} onBack={() => setScreen({ kind: "dashboard" })} onNeedAuth={() => undefined} onAccepted={async (invitation) => { setPendingInviteToken(null); await refreshBootstrap(); setScreen({ kind: "invite-success", invitation }); }} />;
  } else if (screen.kind === "invite-success") {
    const invitation = screen.invitation;
    content = <InviteAcceptedScreen invitation={invitation} onContinue={() => { if (invitation.challengeId) openParticipant(invitation.challengeId); else setScreen({ kind: "group", groupId: invitation.groupId }); }} />;
  } else if (screen.kind === "templates") {
    content = <TemplatesScreen user={user} manageableChallenges={bootstrap.challenges.filter((challenge) => canManage(challenge.viewerRole))} csrfToken={bootstrap.csrfToken} onOpen={(id) => setScreen({ kind: "template", challengeId: id })} onBack={() => setScreen({ kind: "dashboard" })} onSignIn={() => undefined} onChanged={() => { void refreshBootstrap(); }} />;
  } else if (screen.kind === "template") {
    content = <TemplateDetailScreen key={screen.challengeId} user={user} challengeId={screen.challengeId} groups={bootstrap.groups} csrfToken={bootstrap.csrfToken} autoCopy={resumeTemplateCopy === screen.challengeId} onBack={() => { setResumeTemplateCopy(null); setScreen({ kind: "templates" }); }} onSignIn={() => undefined} onDuplicated={async (result) => { setResumeTemplateCopy(null); await refreshBootstrap(); openAdmin(result.challengeId); }} />;
  } else if (screen.kind === "group" && selectedGroup) {
    content = <GroupScreen key={selectedGroup.id} group={selectedGroup} challenges={bootstrap.challenges.filter((challenge) => challenge.groupId === selectedGroup.id)} challengeLimit={bootstrap.limits.challengesPerGroup} onBack={() => setScreen({ kind: "dashboard" })} onCreateChallenge={() => setScreen({ kind: "create-challenge", groupId: selectedGroup.id })} onOpenChallenge={(id) => openParticipant(id)} onCreateInvite={async (payload) => apiRequest<{ token?: string; url?: string }>(API_PATHS.groupInvites(selectedGroup.id), { method: "POST", body: payload, csrfToken: bootstrap.csrfToken })} onAddMemberByUsername={(username) => apiRequest<GroupMemberResult>(API_PATHS.groupMembers(selectedGroup.id), { method: "POST", body: { username }, csrfToken: bootstrap.csrfToken })} onUpdateGroup={(payload) => updateGroup(selectedGroup.id, payload)} onDeleteGroup={selectedGroup.role === "owner" ? () => deleteGroup(selectedGroup.id) : undefined} />;
  } else if (screen.kind === "create-challenge" && selectedGroup && canManage(selectedGroup.role)) {
    content = <CreateChallengeScreen key={selectedGroup.id} group={selectedGroup} onBack={() => setScreen({ kind: "group", groupId: selectedGroup.id })} onCreate={(input) => createChallenge(selectedGroup.id, input)} />;
  } else if ((screen.kind === "challenge" || screen.kind === "admin") && (detailLoading || !selectedChallenge || selectedChallenge.id !== screen.challengeId)) {
    content = detailError ? <main className="mx-auto max-w-2xl px-5 py-16"><EmptyState title="Não foi possível abrir este desafio" description={detailError} action={<Button onClick={() => retryDetail(screen.challengeId)}>Tentar novamente</Button>} /></main> : <LoadingView label="Carregando o desafio…" />;
  } else if (screen.kind === "challenge" && selectedChallenge) {
    content = <ParticipantChallengeScreen key={selectedChallenge.id} challenge={selectedChallenge} entries={entries} user={user} tab={screen.tab} onTab={(tab) => setScreen({ ...screen, tab })} onBack={() => setScreen({ kind: "dashboard" })} onAdmin={canManage(selectedRole) ? () => openAdmin(selectedChallenge.id) : undefined} onSaveEntry={saveEntry} />;
  } else if (screen.kind === "admin" && selectedChallenge && canManage(selectedRole)) {
    content = <AdminScreen key={selectedChallenge.id} challenge={selectedChallenge} entries={entries} group={selectedGroup} duplicateTargets={bootstrap.groups.filter((candidate) => candidate.id !== selectedChallenge.groupId && canManage(candidate.role)).map((candidate) => ({ id: candidate.id, name: candidate.name, challengeCount: bootstrap.challenges.filter((item) => item.groupId === candidate.id).length, challengeLimit: bootstrap.limits.challengesPerGroup }))} tab={screen.tab} onTab={(tab) => setScreen({ ...screen, tab })} onBack={() => selectedGroup ? setScreen({ kind: "group", groupId: selectedGroup.id }) : setScreen({ kind: "dashboard" })} onViewParticipant={() => setScreen({ kind: "challenge", challengeId: selectedChallenge.id, tab: selectedChallenge.status === "closed" ? "results" : "today" })} onSaveBasics={(payload) => mutateChallenge(API_PATHS.challenge(selectedChallenge.id), payload, "PATCH")} onTransition={(status) => mutateChallenge(API_PATHS.transition(selectedChallenge.id), { status })} onDuplicate={duplicateChallenge} onDelete={canManage(selectedRole) ? () => deleteChallenge(selectedChallenge.id, selectedGroup?.id) : undefined} onSaveParticipants={(participantIds) => mutateChallenge(API_PATHS.participants(selectedChallenge.id), { replace: true, participantIds })} onSaveFields={(fields) => mutateChallenge(API_PATHS.fields(selectedChallenge.id), { replace: true, archiveMissing: true, fields })} onAddItems={(payload) => mutateChallenge(API_PATHS.items(selectedChallenge.id), payload)} onUpdateItem={(itemId, payload) => mutateChallenge(API_PATHS.item(selectedChallenge.id, itemId), payload, "PATCH")} onPatchEntry={(entryId, values, reason) => mutateChallenge(API_PATHS.entry(entryId), { values, reason }, "PATCH")} onExport={exportCsv} onAddMetric={(payload) => mutateChallenge(API_PATHS.metrics(selectedChallenge.id), payload)} onSaveResult={(payload) => mutateChallenge(API_PATHS.results(selectedChallenge.id), payload)} />;
  } else if (screen.kind === "admin" || screen.kind === "create-challenge") {
    content = <main className="mx-auto max-w-2xl px-5 py-16"><EmptyState title="Acesso administrativo indisponível" description="Você não possui papel de responsável ou administrador neste grupo. O servidor também valida cada operação." action={<Button onClick={() => setScreen({ kind: "dashboard" })}>Voltar ao início</Button>} /></main>;
  } else {
    content = <DashboardScreen user={user} groups={bootstrap.groups} challenges={bootstrap.challenges} limits={bootstrap.limits} onOpenGroup={(groupId) => setScreen({ kind: "group", groupId })} onOpenChallenge={(id) => openParticipant(id)} onOpenAdmin={(id) => openAdmin(id)} onCreateGroup={createGroup} />;
  }

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <AppHeader user={user} onHome={() => setScreen({ kind: "dashboard" })} onAccount={() => setScreen({ kind: "account" })} onLogout={logout} />
      {content}
    </div>
  );
}
