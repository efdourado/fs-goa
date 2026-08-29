"use client";

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";

type Id = string;
type Role = "owner" | "admin" | "participant";
type ChallengeStatus = "draft" | "active" | "closed";
type FieldType = "text" | "number" | "rating" | "select" | "boolean" | "date";
type SubmissionMode = "item" | "daily" | "free";
type Template = "cine" | "reading";
type AdminTab =
  | "overview"
  | "participants"
  | "fields"
  | "items"
  | "review"
  | "metrics"
  | "results";
type ParticipantTab = "today" | "history" | "progress" | "results";

interface User {
  id: Id;
  name: string;
  username: string;
  platformAdmin?: boolean;
}

interface Member extends User {
  role: Role;
}

interface GroupSummary {
  id: Id;
  name: string;
  description?: string | null;
  role: Role;
  memberCount?: number;
  members?: Member[];
}

interface FieldOption {
  id?: Id;
  label: string;
  value?: string;
}

interface FieldConfig {
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  multiline?: boolean;
  options?: FieldOption[];
}

interface ChallengeField {
  id?: Id;
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  position?: number;
  config?: FieldConfig;
}

interface ChallengeItem {
  id: Id;
  title: string;
  description?: string | null;
  position?: number;
  opensAt?: string | null;
  dueAt?: string | null;
  date?: string | null;
  status?: "scheduled" | "open" | "past_due" | "closed";
}

interface Participant {
  id: Id;
  userId?: Id;
  name: string;
  username?: string;
}

interface EntryValueItem {
  fieldId: Id;
  value: unknown;
}

interface Entry {
  id: Id;
  itemId?: Id | null;
  checkpointId?: Id | null;
  participantId?: Id;
  userId?: Id;
  participantName?: string;
  participantUsername?: string;
  submittedAt?: string;
  updatedAt?: string;
  isLate?: boolean;
  values: Record<Id, unknown> | EntryValueItem[];
}

interface Metric {
  id: Id;
  label: string;
  operation: "sum" | "average" | "count" | "min" | "max" | "completion_rate";
  fieldId?: Id | null;
  groupBy?: "none" | "participant" | "item";
  visibleDuring?: boolean;
  visibleInResults?: boolean;
  value?: string | number | null;
  formattedValue?: string | null;
}

interface ResultComment {
  id: Id;
  entryId?: Id;
  fieldId?: Id;
  authorName?: string;
  text: string;
  itemTitle?: string;
}

interface ChallengeResult {
  headline?: string | null;
  summary?: string | null;
  metrics?: Metric[];
  comments?: ResultComment[];
  publishedAt?: string | null;
}

interface ChallengeSummary {
  id: Id;
  groupId: Id;
  title: string;
  description?: string | null;
  rules?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  status: ChallengeStatus;
  template?: Template | null;
  submissionMode?: SubmissionMode;
  viewerRole?: Role;
  isParticipant?: boolean;
  completedCount?: number;
  totalCount?: number;
}

interface ChallengeDetail extends ChallengeSummary {
  fields: ChallengeField[];
  items: ChallengeItem[];
  participants: Participant[];
  metrics: Metric[];
  result?: ChallengeResult | null;
}

interface BootstrapData {
  csrfToken: string;
  user: User | null;
  groups: GroupSummary[];
  challenges: ChallengeSummary[];
}

interface InvitePreview {
  token?: string;
  groupId: Id;
  groupName: string;
  invitedBy?: string;
  expiresAt?: string | null;
  status?: "valid" | "expired" | "revoked" | "exhausted" | "accepted";
}

interface ApiErrorBody {
  message?: string;
  error?: string;
  errors?: Record<string, string[]>;
}

type Screen =
  | { kind: "loading" }
  | { kind: "auth"; mode: "login" | "register" }
  | { kind: "dashboard" }
  | { kind: "group"; groupId: Id }
  | { kind: "invite"; token: string }
  | { kind: "create-challenge"; groupId: Id }
  | { kind: "challenge"; challengeId: Id; tab: ParticipantTab }
  | { kind: "admin"; challengeId: Id; tab: AdminTab };

/*
 * Este é o único mapa que conhece os caminhos REST. Se o backend mudar uma URL,
 * a adaptação fica concentrada aqui, sem espalhar strings pelos componentes.
 */
const API_PATHS = {
  bootstrap: "/api/bootstrap",
  auth: {
    register: "/api/auth/register",
    login: "/api/auth/login",
    logout: "/api/auth/logout",
  },
  groups: "/api/groups",
  group: (groupId: Id) => `/api/groups/${encodeURIComponent(groupId)}`,
  groupInvites: (groupId: Id) => `/api/groups/${encodeURIComponent(groupId)}/invites`,
  invite: (token: string) => `/api/invites/${encodeURIComponent(token)}`,
  groupChallenges: (groupId: Id) => `/api/groups/${encodeURIComponent(groupId)}/challenges`,
  challenge: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}`,
  participants: (challengeId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/participants`,
  fields: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}/fields`,
  items: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}/items`,
  item: (challengeId: Id, itemId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/items/${encodeURIComponent(itemId)}`,
  metrics: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}/metrics`,
  results: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}/results`,
  entries: (challengeId: Id) => `/api/challenges/${encodeURIComponent(challengeId)}/entries`,
  entry: (entryId: Id) => `/api/entries/${encodeURIComponent(entryId)}`,
  transition: (challengeId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/transition`,
  duplicate: (challengeId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/duplicate`,
  exportEntries: (challengeId: Id) =>
    `/api/challenges/${encodeURIComponent(challengeId)}/export.csv`,
} as const;

class ApiError extends Error {
  status: number;
  fieldErrors?: Record<string, string[]>;

  constructor(message: string, status: number, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

async function apiRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    csrfToken?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.csrfToken) headers.set("x-csrf-token", options.csrfToken);

  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    credentials: "same-origin",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? ((await response.json()) as ApiErrorBody | { data?: T })
    : null;

  if (!response.ok) {
    const errorBody = body as ApiErrorBody | null;
    throw new ApiError(
      errorBody?.message ?? errorBody?.error ?? "Não foi possível concluir a operação.",
      response.status,
      errorBody?.errors,
    );
  }

  if (body && typeof body === "object" && "data" in body && body.data !== undefined) {
    return body.data;
  }
  return body as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Algo deu errado. Tente novamente.";
}

function normalizeBootstrap(raw: BootstrapData | { bootstrap: BootstrapData }): BootstrapData {
  const data = "bootstrap" in raw ? raw.bootstrap : raw;
  return {
    csrfToken: data.csrfToken ?? "",
    user: data.user ?? null,
    groups: data.groups ?? [],
    challenges: data.challenges ?? [],
  };
}

function normalizeChallenge(
  raw: ChallengeDetail | { challenge: ChallengeDetail },
): ChallengeDetail {
  const value = "challenge" in raw ? raw.challenge : raw;
  const aliases = value as ChallengeDetail & {
    checkpoints?: ChallengeItem[];
    challengeItems?: ChallengeItem[];
    challengeFields?: ChallengeField[];
    challengeParticipants?: Participant[];
    challengeMetrics?: Metric[];
    results?: ChallengeResult;
  };
  return {
    ...value,
    fields: aliases.fields ?? aliases.challengeFields ?? [],
    items: aliases.items ?? aliases.checkpoints ?? aliases.challengeItems ?? [],
    participants: aliases.participants ?? aliases.challengeParticipants ?? [],
    metrics: aliases.metrics ?? aliases.challengeMetrics ?? [],
    result: aliases.result ?? aliases.results ?? null,
  };
}

function normalizeEntries(raw: Entry[] | { entries: Entry[] }): Entry[] {
  return Array.isArray(raw) ? raw : raw.entries ?? [];
}

function normalizeCreatedId(raw: unknown): Id | null {
  if (!raw || typeof raw !== "object") return null;
  const object = raw as { id?: string; challengeId?: string; challenge?: { id?: string } };
  return object.id ?? object.challengeId ?? object.challenge?.id ?? null;
}

function canManage(role?: Role): boolean {
  return role === "owner" || role === "admin";
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "campo";
}

function formatDate(value?: string | null, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return "Sem data";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", options ?? { day: "2-digit", month: "short" }).format(
    date,
  );
}

function formatDateTime(value?: string | null): string {
  return formatDate(value, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function valuesAsRecord(values: Entry["values"]): Record<Id, unknown> {
  if (Array.isArray(values)) {
    return Object.fromEntries(values.map((item) => [item.fieldId, item.value]));
  }
  return values ?? {};
}

function itemIdForEntry(entry: Entry): Id | null {
  return entry.itemId ?? entry.checkpointId ?? null;
}

function inviteTokenFromText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed, window.location.origin);
    const queryToken = url.searchParams.get("invite");
    if (queryToken) return queryToken;
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.at(-1) ?? trimmed;
  } catch {
    return trimmed.split("/").filter(Boolean).at(-1) ?? trimmed;
  }
}

const cardClass =
  "rounded-[20px] border border-[var(--line)] bg-[var(--paper)] shadow-[0_1px_2px_rgba(32,36,31,0.04)]";
const inputClass =
  "mb-1 min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3.5 py-2.5 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--violet)] focus:ring-4 focus:ring-[rgba(103,88,216,0.12)] disabled:cursor-not-allowed disabled:bg-[var(--canvas)]";
const labelClass = "mb-1.5 block text-sm font-semibold text-[var(--ink)]";

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function Button({
  children,
  variant = "primary",
  type = "button",
  disabled,
  onClick,
  className,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const tones = {
    primary: "border-transparent bg-[var(--violet)] text-white hover:opacity-90",
    secondary: "border-[var(--line)] bg-transparent text-[var(--ink)] hover:bg-black/[0.04]",
    ghost: "border-transparent bg-transparent text-[var(--muted)] hover:bg-black/[0.04] hover:text-[var(--ink)]",
    danger: "border-red-200 bg-transparent text-red-700 hover:bg-red-50",
  };
  return (
    <button
      className={cx(
        "cursor-pointer inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-200 disabled:cursor-not-allowed disabled:opacity-55",
        tones[variant],
        className,
      )}
      type={type}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function StatusMessage({
  error,
  success,
}: {
  error?: string | null;
  success?: string | null;
}) {
  if (!error && !success) return null;
  return (
    <div
      className={cx(
        "rounded-xl border px-4 py-3 text-sm",
        error ? "border-red-200 bg-red-50 text-red-900" : "border-emerald-200 bg-emerald-50 text-emerald-900",
      )}
      role={error ? "alert" : "status"}
      aria-live="polite"
    >
      {error ?? success}
    </div>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--line)] bg-stone-50/70 px-5 py-10 text-center">
      <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-violet-100 text-xl text-[var(--violet-dark)]" aria-hidden="true">
        ᥫ᭡
      </span>
      <h3 className="text-lg font-bold tracking-[-0.02em]">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

function LoadingView({ label = "Carregando o Goa…" }: { label?: string }) {
  return (
    <div className="grid min-h-screen place-items-center px-6" role="status" aria-live="polite">
      <div className="text-center">
        <span className="mx-auto mb-4 block h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-[var(--violet)]" aria-hidden="true" />
        <p className="text-sm font-semibold text-[var(--muted)]">{label}</p>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="Goa">
      <span className="grid h-9 w-9 -rotate-3 place-items-center rounded-[50%_50%_50%_16%] bg-[var(--ink)] text-lg font-black text-[var(--canvas)] border-1 border-white" aria-hidden="true">
        g
      </span>
      <strong className="text-xl tracking-[-0.06em]">goa</strong>
    </span>
  );
}

function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-[-0.045em] sm:text-4xl">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

function AuthScreen({
  initialMode,
  invitePending,
  onAuthenticated,
  onShowInvite,
}: {
  initialMode: "login" | "register";
  invitePending: boolean;
  onAuthenticated: (mode: "login" | "register", payload: Record<string, string>) => Promise<void>;
  onShowInvite?: () => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("passwordConfirmation") ?? "");
    if (mode === "register" && password !== confirmation) {
      setError("As senhas não coincidem.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAuthenticated(mode, {
        name: String(form.get("name") ?? ""),
        username: String(form.get("username") ?? ""),
        password,
      });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
      <section className="relative hidden overflow-hidden bg-[var(--ink)] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <Brand />
        <div className="relative z-10 max-w-xl">
          <p className="mb-5 text-xs font-bold uppercase tracking-[0.18em] text-[#aaa9a0]">Desafios privados, histórias duradouras</p>
          <h1 className="text-6xl font-semibold leading-[0.96] tracking-[-0.06em]">Você registra.<br />O Goa organiza.</h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-[#c8c9c2]">Crie desafios com seu grupo, acompanhe o que importa e transforme o resultado em uma memória bonita.</p>
        </div>
        <p className="text-xs text-[#8f918b]">Privado por padrão · sem planilhas frágeis</p>
        <span className="absolute -right-24 top-20 h-96 w-96 rounded-full border border-white/10" aria-hidden="true" />
        <span className="absolute -bottom-32 right-24 h-80 w-80 rounded-full bg-[var(--coral)] opacity-90" aria-hidden="true" />
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-10 lg:hidden"><Brand /></div>
          {invitePending ? (
            <button className="mb-5 w-full rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-left text-sm text-violet-900" type="button" onClick={onShowInvite}>
              <strong>Você tem um convite pendente.</strong> Entre ou crie sua conta para aceitar.
            </button>
          ) : null}
          <h2 className="mt-2 text-3xl font-bold tracking-[-0.045em]">{mode === "login" ? "Entre no Goa" : "Crie sua conta"}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{mode === "login" ? "Use seu nome de usuário e senha." : "Só pedimos o essencial. E-mail não é obrigatório."}</p>

          <form className="mt-6 space-y-4" onSubmit={submit}>
            {mode === "register" ? (
              <label>
                <span className={labelClass}>Seu nome</span>
                <input className={inputClass} name="name" autoComplete="name" required maxLength={100} disabled={busy} />
              </label>
            ) : null}
            <label>
              <span className={labelClass}>Usuário</span>
              <input className={inputClass} name="username" autoComplete="username" required minLength={3} maxLength={40} disabled={busy} spellCheck={false} />
              {mode === "register" ? <span className="mt-1 block text-xs text-[var(--muted)] mb-3">Use letras, números, ponto, hífen ou sublinhado.</span> : null}
            </label>
            <label>
              <span className={labelClass}>Senha</span>
              <input className={inputClass} name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} disabled={busy} />
            </label>
            {mode === "register" ? (
              <label>
                <span className={labelClass}>Confirme a senha</span>
                <input className={inputClass} name="passwordConfirmation" type="password" autoComplete="new-password" required minLength={8} disabled={busy} />
              </label>
            ) : null}
            <StatusMessage error={error} />
            <Button type="submit" disabled={busy} className="w-full mt-6">
              {busy ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"}
              {!busy ? <span aria-hidden="true">→</span> : null}
            </Button>
          </form>
          <p className="mt-3 text-center text-sm text-[var(--muted)]">
            {mode === "login" ? "Sem conta?" : "Já tem uma conta?"}{" "}
            <button className="min-h-11 font-bold underline-offset-4 hover:underline cursor-pointer" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>
              {mode === "login" ? "Cadastre-se" : "Entrar"}
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}

function AppHeader({
  user,
  onHome,
  onLogout,
}: {
  user: User;
  onHome: () => void;
  onLogout: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-black/10 bg-[rgba(245,241,232,0.92)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:h-[76px] sm:px-6">
        <button className="rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-200" type="button" onClick={onHome}><Brand /></button>
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <strong className="block text-sm">{user.name}</strong>
            <span className="block text-xs text-[var(--muted)]">@{user.username}</span>
          </div>
          <span className="grid h-10 w-10 place-items-center rounded-full border-2 border-white bg-violet-200 text-xs font-black" aria-hidden="true">
            {user.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}
          </span>
          <button
            className="min-h-11 rounded-xl px-2 text-xs font-bold text-[var(--muted)] hover:bg-white hover:text-[var(--ink)] disabled:opacity-50 sm:px-3"
            type="button"
            disabled={busy}
            onClick={async () => { setBusy(true); try { await onLogout(); } finally { setBusy(false); } }}
          >
            {busy ? "Saindo…" : "Sair"}
          </button>
        </div>
      </div>
    </header>
  );
}

function ChallengeStatusBadge({ status }: { status: ChallengeStatus }) {
  const labels = { draft: "Rascunho", active: "Ativo", closed: "Encerrado" };
  return (
    <span className={cx(
      "inline-flex rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.1em]",
      status === "active" && "bg-emerald-100 text-emerald-800",
      status === "draft" && "bg-amber-100 text-amber-900",
      status === "closed" && "bg-stone-200 text-stone-700",
    )}>{labels[status]}</span>
  );
}

function DashboardScreen({
  user,
  groups,
  challenges,
  onOpenGroup,
  onOpenChallenge,
  onOpenAdmin,
  onCreateGroup,
  onOpenInvite,
}: {
  user: User;
  groups: GroupSummary[];
  challenges: ChallengeSummary[];
  onOpenGroup: (id: Id) => void;
  onOpenChallenge: (id: Id) => void;
  onOpenAdmin: (id: Id) => void;
  onCreateGroup: (name: string) => Promise<void>;
  onOpenInvite: (token: string) => void;
}) {
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = challenges.filter((challenge) => challenge.status === "active");
  const other = challenges.filter((challenge) => challenge.status !== "active");

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await onCreateGroup(name);
      setShowGroupForm(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = inviteTokenFromText(String(new FormData(event.currentTarget).get("invite") ?? ""));
    if (token) onOpenInvite(token);
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <PageHeading title={`Olá, ${user.name.split(" ")[0]}.`} description="Veja o que pede sua atenção hoje ou comece uma nova experiência com seu grupo." action={<Button onClick={() => setShowGroupForm(true)}><span>+</span>Criar grupo</Button>} />

      {showGroupForm ? (
        <form className={cx(cardClass, "mb-7 grid gap-4 p-5 sm:grid-cols-[1fr_auto]")} onSubmit={createGroup}>
          <label>
            <span className={labelClass}>Nome do grupo</span>
            <input className={inputClass} name="name" placeholder="Ex.: Clube do Sofá" required maxLength={100} disabled={busy} />
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={busy}>{busy ? "Criando…" : "Criar"}</Button>
            <Button variant="ghost" onClick={() => setShowGroupForm(false)}>Cancelar</Button>
          </div>
          <div className="sm:col-span-2"><StatusMessage error={error} /></div>
        </form>
      ) : null}

      <section aria-labelledby="active-title">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="active-title" className="text-xl font-bold tracking-[-0.03em]">Para acompanhar agora</h2>
          <span className="text-xs font-semibold text-[var(--muted)]">{active.length} {active.length === 1 ? "desafio" : "desafios"}</span>
        </div>
        {active.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {active.map((challenge) => (
              <article className={cx(cardClass, "overflow-hidden p-5")} key={challenge.id}>
                <div className="flex items-start justify-between gap-3"><ChallengeStatusBadge status={challenge.status} /><span className="text-xs text-[var(--muted)]">{challenge.endsOn ? `até ${formatDate(challenge.endsOn)}` : "sem prazo"}</span></div>
                <h3 className="mt-5 text-2xl font-bold tracking-[-0.04em]">{challenge.title}</h3>
                {challenge.description ? <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--muted)]">{challenge.description}</p> : null}
                {typeof challenge.totalCount === "number" && challenge.totalCount > 0 ? (
                  <div className="mt-5">
                    <div className="mb-2 flex justify-between text-xs text-[var(--muted)]"><span>{challenge.completedCount ?? 0} de {challenge.totalCount}</span><span>{Math.round(((challenge.completedCount ?? 0) / challenge.totalCount) * 100)}%</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-stone-200"><span className="block h-full rounded-full bg-[var(--coral)]" style={{ width: `${Math.min(100, ((challenge.completedCount ?? 0) / challenge.totalCount) * 100)}%` }} /></div>
                  </div>
                ) : null}
                <div className="mt-6 flex flex-wrap gap-2">
                  <Button onClick={() => onOpenChallenge(challenge.id)} className="flex-1">Abrir desafio</Button>
                  {canManage(challenge.viewerRole) ? <Button variant="secondary" onClick={() => onOpenAdmin(challenge.id)}>Administrar</Button> : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="Nada pendente por aqui" description="Quando um desafio do seu grupo estiver ativo, ele aparecerá aqui com o próximo registro." />
        )}
      </section>

      <section className="mt-10 grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
        <div>
          <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-bold tracking-[-0.03em]">Seus grupos</h2><span className="text-xs text-[var(--muted)]">{groups.length}</span></div>
          {groups.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {groups.map((group) => (
                <button className={cx(cardClass, "flex min-h-24 items-center justify-between gap-4 p-4 text-left transition hover:-translate-y-0.5 hover:border-violet-300")} type="button" onClick={() => onOpenGroup(group.id)} key={group.id}>
                  <span><strong className="block text-base">{group.name}</strong><small className="mt-1 block text-[var(--muted)]">{group.memberCount ?? group.members?.length ?? 0} pessoas · {group.role === "owner" ? "responsável" : group.role === "admin" ? "admin" : "participante"}</small></span>
                  <span className="text-lg text-[var(--violet-dark)]" aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          ) : <EmptyState title="Crie seu primeiro grupo" description="Um grupo reúne pessoas e continua existindo entre diferentes edições de desafios." action={<Button onClick={() => setShowGroupForm(true)}><span>+</span>Criar grupo</Button>} />}
        </div>
        <aside className={cx(cardClass, "p-5")}>
          <h2 className="mt-2 text-xl font-bold tracking-[-0.03em]">Recebeu um convite?</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Cole o link ou o código enviado pelo administrador.</p>
          <form className="mt-5 space-y-3" onSubmit={submitInvite}>
            <label><span className="sr-only">Link ou código do convite</span><input className={inputClass} name="invite" placeholder="Link ou código do convite" required /></label>
            <Button type="submit" variant="secondary" className="w-full">Ir</Button>
          </form>
        </aside>
      </section>

      {other.length ? (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-bold tracking-[-0.03em]">Rascunhos e memórias</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {other.map((challenge) => (
              <button className={cx(cardClass, "flex items-center justify-between gap-3 p-4 text-left hover:border-violet-300")} type="button" onClick={() => challenge.status === "draft" && canManage(challenge.viewerRole) ? onOpenAdmin(challenge.id) : onOpenChallenge(challenge.id)} key={challenge.id}>
                <span><ChallengeStatusBadge status={challenge.status} /><strong className="mt-2 block">{challenge.title}</strong></span><span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function GroupScreen({
  group,
  challenges,
  onBack,
  onCreateChallenge,
  onOpenChallenge,
  onOpenAdmin,
  onCreateInvite,
  onUpdateGroup,
  onDeleteGroup,
}: {
  group: GroupSummary;
  challenges: ChallengeSummary[];
  onBack: () => void;
  onCreateChallenge: () => void;
  onOpenChallenge: (id: Id) => void;
  onOpenAdmin: (id: Id) => void;
  onCreateInvite: (payload: { expiresInDays: number; maxUses: number }) => Promise<{ token?: string; url?: string }>;
  onUpdateGroup: (payload: { name: string; description: string }) => Promise<void>;
  onDeleteGroup?: () => Promise<void>;
}) {
  const [showInvite, setShowInvite] = useState(false);
  const [showGroupEdit, setShowGroupEdit] = useState(false);
  const [groupName, setGroupName] = useState(group.name);
  const [groupDescription, setGroupDescription] = useState(group.description ?? "");
  const [inviteUrl, setInviteUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [groupSuccess, setGroupSuccess] = useState<string | null>(null);

  function toggleGroupEdit() {
    if (!showGroupEdit) {
      setGroupName(group.name);
      setGroupDescription(group.description ?? "");
      setGroupError(null);
      setGroupSuccess(null);
    }
    setShowGroupEdit(!showGroupEdit);
  }

  async function updateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGroupBusy(true);
    setGroupError(null);
    setGroupSuccess(null);
    try {
      await onUpdateGroup({ name: groupName.trim(), description: groupDescription.trim() });
      setGroupSuccess("Grupo atualizado.");
    } catch (cause) {
      setGroupError(errorMessage(cause));
    } finally {
      setGroupBusy(false);
    }
  }

  async function deleteGroup() {
    if (!onDeleteGroup) return;
    if (!window.confirm(`Mover "${group.name}" para a lixeira? Os desafios e registros somem do app, mas ficam recuperáveis até você limpar a lixeira na administração.`)) return;
    setGroupBusy(true);
    setGroupError(null);
    try {
      await onDeleteGroup();
    } catch (cause) {
      setGroupError(errorMessage(cause));
      setGroupBusy(false);
    }
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const created = await onCreateInvite({
        expiresInDays: Number(form.get("expiresInDays") ?? 7),
        maxUses: Number(form.get("maxUses") ?? 1),
      });
      const token = created.token ?? "";
      setInviteUrl(created.url ?? (token ? `${window.location.origin}/?invite=${encodeURIComponent(token)}` : ""));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <button className="mb-6 min-h-11 text-sm font-bold text-[var(--muted)] hover:text-[var(--ink)]" type="button" onClick={onBack}>← Voltar ao início</button>
      <PageHeading title={group.name} description={`${group.description ? `${group.description} · ` : ""}${group.memberCount ?? group.members?.length ?? 0} pessoas · você é ${group.role === "owner" ? "responsável" : group.role === "admin" ? "admin" : "participante"}`} action={canManage(group.role) ? <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={toggleGroupEdit}>{showGroupEdit ? "Fechar edição" : "Editar grupo"}</Button><Button variant="secondary" onClick={() => setShowInvite(!showInvite)}>Convidar</Button><Button onClick={onCreateChallenge}>+ Novo desafio</Button></div> : undefined} />

      {showGroupEdit ? (
        <section className={cx(cardClass, "mb-7 p-5")} aria-labelledby="group-edit-title">
          <h2 id="group-edit-title" className="text-lg font-bold">Editar grupo</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">O nome atualizado aparece para todas as pessoas do grupo.</p>
          <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={updateGroup}>
            <label className="sm:col-span-2"><span className={labelClass}>Nome</span><input className={inputClass} value={groupName} onChange={(event) => setGroupName(event.target.value)} required maxLength={120} /></label>
            <label className="sm:col-span-2"><span className={labelClass}>Descrição</span><textarea className={inputClass} rows={3} value={groupDescription} onChange={(event) => setGroupDescription(event.target.value)} maxLength={1000} placeholder="O que reúne este grupo?" /></label>
            <div className="sm:col-span-2"><StatusMessage error={groupError} success={groupSuccess} /></div>
            <div className="flex flex-wrap gap-2 sm:col-span-2"><Button type="submit" disabled={groupBusy}>{groupBusy ? "Salvando…" : "Salvar grupo"}</Button><Button variant="ghost" disabled={groupBusy} onClick={toggleGroupEdit}>Cancelar</Button></div>
          </form>
          {onDeleteGroup ? (
            <div className="mt-5 border-t border-[var(--line)] pt-4">
              <Button variant="danger" disabled={groupBusy} onClick={() => void deleteGroup()}>Apagar grupo</Button>
              <p className="mt-2 text-xs text-[var(--muted)]">Vai para a lixeira. Recuperável até você limpar a lixeira na administração.</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {showInvite ? (
        <section className={cx(cardClass, "mb-7 p-5")} aria-labelledby="invite-create-title">
          <h2 id="invite-create-title" className="text-lg font-bold">Criar convite seguro</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">O link expira e pode ter uso limitado. Gere um novo quando precisar.</p>
          <form className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]" onSubmit={createInvite}>
            <label><span className={labelClass}>Expira em</span><select className={inputClass} name="expiresInDays" defaultValue="7"><option value="1">1 dia</option><option value="7">7 dias</option><option value="30">30 dias</option></select></label>
            <label><span className={labelClass}>Quantidade de usos</span><input className={inputClass} name="maxUses" type="number" min={1} max={100} defaultValue={1} /></label>
            <div className="flex items-end"><Button type="submit" disabled={busy}>{busy ? "Gerando…" : "Gerar link"}</Button></div>
          </form>
          <div className="mt-4"><StatusMessage error={error} /></div>
          {inviteUrl ? (
            <div className="mt-4 flex flex-col gap-2 rounded-xl bg-violet-50 p-3 sm:flex-row sm:items-center">
              <input className={cx(inputClass, "font-mono text-xs")} value={inviteUrl} readOnly aria-label="Link do convite" />
              <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(inviteUrl)}>Copiar</Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-7 lg:grid-cols-[1fr_320px]">
        <section>
          <h2 className="mb-4 text-xl font-bold tracking-[-0.03em]">Desafios do grupo</h2>
          {challenges.length ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {challenges.map((challenge) => (
                <article className={cx(cardClass, "p-5")} key={challenge.id}>
                  <ChallengeStatusBadge status={challenge.status} />
                  <h3 className="mt-4 text-xl font-bold">{challenge.title}</h3>
                  <p className="mt-2 text-sm text-[var(--muted)]">{challenge.startsOn || challenge.endsOn ? `${formatDate(challenge.startsOn)} — ${formatDate(challenge.endsOn)}` : "Datas ainda não definidas"}</p>
                  <div className="mt-5 flex gap-2"><Button onClick={() => onOpenChallenge(challenge.id)} className="flex-1">Abrir</Button>{canManage(group.role) ? <Button variant="secondary" onClick={() => onOpenAdmin(challenge.id)}>Admin</Button> : null}</div>
                </article>
              ))}
            </div>
          ) : <EmptyState title="Este grupo ainda não tem desafios" description={canManage(group.role) ? "Escolha um preset e configure a primeira edição." : "Quando um administrador criar um desafio, ele aparecerá aqui."} action={canManage(group.role) ? <Button onClick={onCreateChallenge}>Criar desafio</Button> : undefined} />}
        </section>
        <aside className={cx(cardClass, "h-fit p-5")}>
          <h2 className="text-lg font-bold">Pessoas</h2>
          {group.members?.length ? (
            <ul className="mt-3 divide-y divide-[var(--line)]">
              {group.members.map((member) => <li className="flex items-center justify-between gap-3 py-3" key={member.id}><span><strong className="block text-sm">{member.name}</strong><small className="text-[var(--muted)]">@{member.username}</small></span><span className="rounded-full bg-stone-100 px-2 py-1 text-[10px] font-bold uppercase">{member.role}</span></li>)}
            </ul>
          ) : <p className="mt-3 text-sm leading-6 text-[var(--muted)]">A lista de membros aparecerá quando o bootstrap a disponibilizar.</p>}
        </aside>
      </div>
    </main>
  );
}

function InviteScreen({
  token,
  user,
  onBack,
  onNeedAuth,
  onAccepted,
  csrfToken,
}: {
  token: string;
  user: User | null;
  onBack: () => void;
  onNeedAuth: () => void;
  onAccepted: () => Promise<void>;
  csrfToken: string;
}) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<InvitePreview | { invite: InvitePreview }>(API_PATHS.invite(token), { signal: controller.signal })
      .then((response) => setPreview("invite" in response ? response.invite : response))
      .catch((cause: unknown) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(errorMessage(cause)); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [token]);

  async function accept() {
    if (!user) { onNeedAuth(); return; }
    setBusy(true);
    setError(null);
    try {
      await apiRequest(API_PATHS.invite(token), { method: "POST", body: {}, csrfToken });
      await onAccepted();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-76px)] max-w-2xl items-center px-4 py-10 sm:px-6">
      <section className={cx(cardClass, "w-full p-6 text-center sm:p-10")}>
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--coral)] text-2xl" aria-hidden="true">◎</span>
        {loading ? <p className="mt-5 text-sm text-[var(--muted)]" role="status">Verificando convite…</p> : preview ? (
          <>
            <p className="mt-6 text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--muted)]">Convite para um grupo privado</p>
            <h1 className="mt-2 text-3xl font-bold tracking-[-0.04em]">{preview.groupName}</h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--muted)]">{preview.invitedBy ? `${preview.invitedBy} convidou você para participar dos desafios deste grupo.` : "Ao aceitar, você poderá ver os desafios disponíveis para os membros."}</p>
            {preview.expiresAt ? <p className="mt-3 text-xs font-semibold text-[var(--muted)]">Válido até {formatDateTime(preview.expiresAt)}</p> : null}
            {preview.status && preview.status !== "valid" ? <div className="mt-5"><StatusMessage error={preview.status === "expired" ? "Este convite expirou." : preview.status === "revoked" ? "Este convite foi revogado." : preview.status === "exhausted" ? "Este convite já atingiu o limite de usos." : "Este convite já foi aceito."} /></div> : (
              <Button className="mt-7 w-full sm:w-auto" disabled={busy} onClick={() => void accept()}>{busy ? "Aceitando…" : user ? `Aceitar como ${user.name}` : "Entrar para aceitar"}</Button>
            )}
          </>
        ) : null}
        <div className="mt-5"><StatusMessage error={error} /></div>
        <button className="mt-6 min-h-11 text-sm font-bold text-[var(--muted)] hover:text-[var(--ink)]" type="button" onClick={onBack}>← Voltar</button>
      </section>
    </main>
  );
}

const fieldTypeLabels: Record<FieldType, string> = {
  text: "Texto",
  number: "Número",
  rating: "Nota",
  select: "Opções",
  boolean: "Sim ou não",
  date: "Data",
};

function presetFields(template: Template): ChallengeField[] {
  if (template === "cine") {
    return [
      { key: "nota", label: "Nota", type: "rating", required: true, config: { min: 0, max: 5, step: 0.5 } },
      { key: "comentario", label: "Comentário", type: "text", required: false, config: { multiline: true, maxLength: 280 } },
    ];
  }
  return [
    { key: "livro_atual", label: "Livro atual", type: "text", required: true },
    { key: "paginas_lidas", label: "Páginas lidas", type: "number", required: true, config: { min: 0, step: 1 } },
    { key: "livro_concluido", label: "Livro concluído?", type: "boolean", required: false },
    { key: "nota_do_livro", label: "Nota do livro", type: "rating", required: false, config: { min: 0, max: 5, step: 0.5 } },
    { key: "comentario", label: "Comentário", type: "text", required: false, config: { multiline: true, maxLength: 280 } },
  ];
}

function cleanFields(fields: ChallengeField[]): ChallengeField[] {
  return fields.map((field, index) => ({
    ...(field.id ? { id: field.id } : {}),
    key: field.key,
    label: field.label.trim(),
    type: field.type,
    required: field.required,
    position: index,
    config: {
      ...field.config,
      options: field.config?.options?.filter((option) => option.label.trim()).map((option) => ({ ...option, label: option.label.trim(), value: option.value || slugify(option.label) })),
    },
  }));
}

function FieldBuilder({
  fields,
  onChange,
  lockPersistedTypes = false,
}: {
  fields: ChallengeField[];
  onChange: (fields: ChallengeField[]) => void;
  lockPersistedTypes?: boolean;
}) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [required, setRequired] = useState(true);

  function update(index: number, patch: Partial<ChallengeField>) {
    onChange(fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field));
  }

  function updateConfig(index: number, patch: Partial<FieldConfig>) {
    const field = fields[index];
    update(index, { config: { ...field.config, ...patch } });
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function addField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanLabel = label.trim();
    if (!cleanLabel) return;
    const base = slugify(cleanLabel);
    let key = base;
    let suffix = 2;
    while (fields.some((field) => field.key === key)) key = `${base}_${suffix++}`;
    const config: FieldConfig | undefined =
      type === "rating" ? { min: 0, max: 5, step: 0.5 }
        : type === "select" ? { options: [] }
          : type === "number" ? { step: 1 }
            : type === "text" ? { maxLength: 280 }
              : undefined;
    onChange([...fields, { key, label: cleanLabel, type, required, config }]);
    setLabel("");
    setType("text");
    setRequired(true);
  }

  return (
    <div className="space-y-4">
      {fields.length ? (
        <ol className="space-y-3">
          {fields.map((field, index) => (
            <li className="rounded-2xl border border-[var(--line)] bg-white p-4" key={field.id ?? field.key}>
              <div className="grid gap-3 md:grid-cols-[1.4fr_0.8fr_auto]">
                <label><span className={labelClass}>Rótulo</span><input className={inputClass} value={field.label} maxLength={100} onChange={(event) => update(index, { label: event.target.value })} /></label>
                <label><span className={labelClass}>Tipo</span><select className={inputClass} value={field.type} disabled={lockPersistedTypes && Boolean(field.id)} onChange={(event) => update(index, { type: event.target.value as FieldType })}>{Object.entries(fieldTypeLabels).map(([value, text]) => <option value={value} key={value}>{text}</option>)}</select></label>
                <label className="flex min-h-12 items-center gap-2 self-end rounded-xl border border-[var(--line)] px-3 text-sm font-semibold"><input type="checkbox" checked={field.required} onChange={(event) => update(index, { required: event.target.checked })} />Obrigatório</label>
              </div>

              {field.type === "rating" || field.type === "number" ? (
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <label><span className={labelClass}>Mínimo</span><input className={inputClass} type="number" step="any" value={field.config?.min ?? ""} disabled={field.type === "rating"} onChange={(event) => updateConfig(index, { min: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
                  <label><span className={labelClass}>Máximo</span><input className={inputClass} type="number" step="any" value={field.config?.max ?? ""} disabled={field.type === "rating"} onChange={(event) => updateConfig(index, { max: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
                  <label><span className={labelClass}>Intervalo</span><input className={inputClass} type="number" step="any" min="0.01" value={field.config?.step ?? 1} disabled={field.type === "rating"} onChange={(event) => updateConfig(index, { step: Number(event.target.value) || 1 })} /></label>
                </div>
              ) : null}
              {field.type === "select" ? (
                <label className="mt-3 block"><span className={labelClass}>Opções separadas por vírgula</span><input className={inputClass} value={(field.config?.options ?? []).map((option) => option.label).join(", ")} onChange={(event) => updateConfig(index, { options: event.target.value.split(",").map((option) => ({ label: option.trim(), value: slugify(option) })) })} placeholder="Opção A, Opção B, Opção C" /></label>
              ) : null}
              {field.type === "text" ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="flex min-h-12 items-center gap-2 rounded-xl border border-[var(--line)] px-3 text-sm font-semibold"><input type="checkbox" checked={field.config?.multiline ?? false} onChange={(event) => updateConfig(index, { multiline: event.target.checked })} />Texto longo</label><label><span className={labelClass}>Limite de caracteres</span><input className={inputClass} type="number" min={1} max={5000} value={field.config?.maxLength ?? 280} onChange={(event) => updateConfig(index, { maxLength: Number(event.target.value) || 280 })} /></label></div>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <code className="rounded bg-stone-100 px-2 py-1 text-[11px] text-[var(--muted)]">{field.key}</code>
                <div className="flex gap-1"><Button variant="ghost" onClick={() => move(index, -1)} disabled={index === 0} className="px-3" >↑<span className="sr-only">Mover para cima</span></Button><Button variant="ghost" onClick={() => move(index, 1)} disabled={index === fields.length - 1} className="px-3">↓<span className="sr-only">Mover para baixo</span></Button><Button variant="danger" onClick={() => onChange(fields.filter((_, fieldIndex) => fieldIndex !== index))}>Remover</Button></div>
              </div>
            </li>
          ))}
        </ol>
      ) : <EmptyState title="Nenhum campo configurado" description="Adicione pelo menos um campo para que os participantes possam registrar algo." />}

      <form className="rounded-2xl border border-dashed border-violet-300 bg-violet-50/60 p-4" onSubmit={addField}>
        <p className="mb-3 text-sm font-bold text-violet-950">Adicionar campo</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto_auto]">
          <label><span className="sr-only">Nome do campo</span><input className={inputClass} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ex.: Páginas lidas" maxLength={100} required /></label>
          <label><span className="sr-only">Tipo do campo</span><select className={inputClass} value={type} onChange={(event) => setType(event.target.value as FieldType)}>{Object.entries(fieldTypeLabels).map(([value, text]) => <option value={value} key={value}>{text}</option>)}</select></label>
          <label className="flex min-h-12 items-center gap-2 rounded-xl bg-white px-3 text-sm font-semibold"><input type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} />Obrigatório</label>
          <Button type="submit">Adicionar</Button>
        </div>
      </form>
    </div>
  );
}

interface ChallengeCreationInput {
  template: Template;
  title: string;
  description: string;
  rules: string;
  startsOn: string;
  endsOn: string;
  submissionMode: SubmissionMode;
  fields: ChallengeField[];
  items: Array<{ title: string; position: number }>;
  generateDaily: boolean;
  participantIds: Id[];
}

function CreateChallengeScreen({
  group,
  onBack,
  onCreate,
}: {
  group: GroupSummary;
  onBack: () => void;
  onCreate: (input: ChallengeCreationInput) => Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const [template, setTemplate] = useState<Template | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [fields, setFields] = useState<ChallengeField[]>([]);
  const [itemsText, setItemsText] = useState("");
  const [participantIds, setParticipantIds] = useState<Id[]>(group.members?.map((member) => member.id) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = useMemo(() => itemsText.split("\n").map((item) => item.trim()).filter(Boolean), [itemsText]);

  function chooseTemplate(next: Template) {
    setTemplate(next);
    setFields(presetFields(next));
    setTitle(next === "cine" ? "Cine — nova edição" : "90 dias de leitura");
    setItemsText("");
  }

  function nextStep() {
    setError(null);
    if (step === 1 && (!template || !title.trim() || !startsOn || !endsOn)) {
      setError("Escolha um modelo e preencha título e datas.");
      return;
    }
    if (step === 2 && !fields.length) {
      setError("Adicione pelo menos um campo.");
      return;
    }
    if (step === 3 && template === "cine" && !items.length) {
      setError("Adicione ao menos um item para o desafio de filmes.");
      return;
    }
    setStep((current) => Math.min(4, current + 1));
  }

  async function submit() {
    if (!template) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        template,
        title: title.trim(),
        description: description.trim(),
        rules: rules.trim(),
        startsOn,
        endsOn,
        submissionMode: template === "reading" ? "daily" : "item",
        fields: cleanFields(fields),
        items: items.map((item, position) => ({ title: item, position })),
        generateDaily: template === "reading",
        participantIds,
      });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const stepLabels = ["Base", "Campos", "Checkpoints", "Pessoas"];
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <button className="mb-6 min-h-11 text-sm font-bold text-[var(--muted)] hover:text-[var(--ink)]" type="button" onClick={onBack}>← Voltar para {group.name}</button>
      <PageHeading title="Monte a próxima experiência" description="Comece com um preset e ajuste somente o que seu grupo precisa." />
      <nav className="mb-6 grid grid-cols-4 gap-1 rounded-2xl bg-stone-200/70 p-1" aria-label="Etapas de criação">
        {stepLabels.map((label, index) => <button className={cx("min-h-11 rounded-xl px-2 text-xs font-bold sm:text-sm", step === index + 1 ? "bg-white text-[var(--violet-dark)] shadow-sm" : index + 1 < step ? "text-[var(--ink)]" : "text-[var(--muted)]")} type="button" onClick={() => index + 1 < step && setStep(index + 1)} disabled={index + 1 > step} key={label}><span className="hidden sm:inline">{index + 1}. </span>{label}</button>)}
      </nav>

      <section className={cx(cardClass, "p-5 sm:p-7")}>
        {step === 1 ? (
          <div>
            <h2 className="text-xl font-bold">Escolha um ponto de partida</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(["cine", "reading"] as const).map((value) => (
                <button className={cx("rounded-2xl border p-5 text-left transition", template === value ? "border-[var(--violet)] bg-violet-50 ring-2 ring-violet-200" : "border-[var(--line)] bg-white hover:border-violet-300")} type="button" aria-pressed={template === value} onClick={() => chooseTemplate(value)} key={value}>
                  <span className="text-2xl" aria-hidden="true">{value === "cine" ? "◉" : "▤"}</span>
                  <strong className="mt-3 block text-lg">{value === "cine" ? "Cine" : "Leitura"}</strong>
                  <span className="mt-1 block text-sm leading-6 text-[var(--muted)]">{value === "cine" ? "Uma lista de títulos, nota e comentário por item." : "Check-in diário com páginas, livro e conclusão."}</span>
                </button>
              ))}
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2"><span className={labelClass}>Título</span><input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} required /></label>
              <label><span className={labelClass}>Início</span><input className={inputClass} type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} required /></label>
              <label><span className={labelClass}>Término</span><input className={inputClass} type="date" min={startsOn} value={endsOn} onChange={(event) => setEndsOn(event.target.value)} required /></label>
              <label className="sm:col-span-2"><span className={labelClass}>Descrição <small className="font-normal text-[var(--muted)]">opcional</small></span><textarea className={inputClass} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} /></label>
              <label className="sm:col-span-2"><span className={labelClass}>Regras <small className="font-normal text-[var(--muted)]">opcional</small></span><textarea className={inputClass} rows={4} value={rules} onChange={(event) => setRules(event.target.value)} maxLength={5000} /></label>
            </div>
          </div>
        ) : null}

        {step === 2 ? <div><h2 className="text-xl font-bold">O que cada pessoa registra?</h2><p className="mb-5 mt-1 text-sm text-[var(--muted)]">O identificador de cada campo permanece estável mesmo se o rótulo mudar.</p><FieldBuilder fields={fields} onChange={setFields} /></div> : null}

        {step === 3 ? (
          <div>
            <h2 className="text-xl font-bold">Defina os checkpoints</h2>
            {template === "cine" ? (
              <><p className="mt-1 text-sm leading-6 text-[var(--muted)]">Cole um título por linha. Cada item vira uma oportunidade de registro para cada participante.</p><label className="mt-5 block"><span className={labelClass}>Lista de itens</span><textarea className={inputClass} rows={12} value={itemsText} onChange={(event) => setItemsText(event.target.value)} placeholder={"Primeiro título\nSegundo título\nTerceiro título"} /></label><p className="mt-2 text-xs font-semibold text-[var(--muted)]">{items.length} {items.length === 1 ? "item" : "itens"}</p></>
            ) : (
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><strong className="text-emerald-950">Check-ins diários</strong><p className="mt-2 text-sm leading-6 text-emerald-900">O servidor criará um checkpoint por dia entre {formatDate(startsOn)} e {formatDate(endsOn)}. Datas e limites são validados novamente no servidor.</p></div>
            )}
          </div>
        ) : null}

        {step === 4 ? (
          <div>
            <h2 className="text-xl font-bold">Quem vai participar?</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Somente membros selecionados poderão enviar registros. Administradores continuam com acesso à revisão.</p>
            {group.members?.length ? (
              <fieldset className="mt-5 grid gap-3 sm:grid-cols-2">
                <legend className="sr-only">Participantes</legend>
                {group.members.map((member) => <label className="flex min-h-14 items-center gap-3 rounded-xl border border-[var(--line)] bg-white px-4" key={member.id}><input type="checkbox" aria-label={`Selecionar ${member.name}`} checked={participantIds.includes(member.id)} onChange={(event) => setParticipantIds((current) => event.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id))} /><span><strong className="block text-sm">{member.name}</strong><small className="text-[var(--muted)]">@{member.username}</small></span></label>)}
              </fieldset>
            ) : <EmptyState title="Membros ainda não carregados" description="Você pode salvar o desafio como rascunho e adicionar participantes na área administrativa." />}
            <div className="mt-6 rounded-2xl bg-stone-100 p-5 text-sm leading-6"><strong className="block text-base">Resumo do rascunho</strong><span className="mt-2 block text-[var(--muted)]">{fields.length} campos · {template === "reading" ? "checkpoints diários" : `${items.length} itens`} · {participantIds.length} participantes</span><p className="mt-2 text-[var(--muted)]">O desafio será criado como rascunho. Revise tudo na administração antes de ativar.</p></div>
          </div>
        ) : null}

        <div className="mt-6"><StatusMessage error={error} /></div>
        <div className="mt-7 flex flex-col-reverse gap-2 border-t border-[var(--line)] pt-5 sm:flex-row sm:justify-between">
          <Button variant="secondary" onClick={() => step === 1 ? onBack() : setStep((current) => current - 1)}>{step === 1 ? "Cancelar" : "← Voltar"}</Button>
          {step < 4 ? <Button onClick={nextStep}>Continuar →</Button> : <Button disabled={busy} onClick={() => void submit()}>{busy ? "Criando rascunho…" : "Criar rascunho"}</Button>}
        </div>
      </section>
    </main>
  );
}

function ratingChoices(config?: FieldConfig): number[] {
  const min = config?.min ?? 0;
  const max = config?.max ?? 5;
  const step = config?.step && config.step > 0 ? config.step : 0.5;
  const count = Math.min(41, Math.floor((max - min) / step) + 1);
  return Array.from({ length: Math.max(0, count) }, (_, index) => Number((min + index * step).toFixed(4)));
}

function DynamicEntryForm({
  fields,
  item,
  entry,
  canEdit,
  onSave,
}: {
  fields: ChallengeField[];
  item: ChallengeItem | null;
  entry?: Entry;
  canEdit: boolean;
  onSave: (values: Record<Id, unknown>, entry?: Entry) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<Id, unknown>>(() => entry ? valuesAsRecord(entry.values) : {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function setValue(field: ChallengeField, value: unknown) {
    if (!field.id) return;
    setValues((current) => ({ ...current, [field.id as Id]: value }));
    setSuccess(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missing = fields.find((field) => {
      if (!field.required || !field.id) return false;
      const value = values[field.id];
      return value === undefined || value === null || value === "";
    });
    if (missing) {
      setError(`Preencha o campo “${missing.label}”.`);
      document.getElementById(`entry-field-${missing.id}`)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await onSave(values, entry);
      setSuccess(entry ? "Registro atualizado." : "Registro salvo.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!fields.length) {
    return <EmptyState title="Formulário ainda não configurado" description="Um administrador precisa adicionar os campos antes de o desafio receber registros." />;
  }

  return (
    <form className="space-y-5" onSubmit={submit} noValidate>
      {fields.map((field) => {
        if (!field.id) return null;
        const id = `entry-field-${field.id}`;
        const value = values[field.id];
        return (
          <div key={field.id}>
            <label className={labelClass} htmlFor={field.type === "rating" || field.type === "boolean" ? undefined : id}>{field.label}{field.required ? <span className="ml-1 text-[var(--coral)]" aria-label="obrigatório">*</span> : <small className="ml-2 font-normal text-[var(--muted)]">opcional</small>}</label>
            {field.type === "text" && field.config?.multiline ? <textarea id={id} className={inputClass} rows={4} value={String(value ?? "")} maxLength={field.config.maxLength} disabled={!canEdit || busy} onChange={(event) => setValue(field, event.target.value)} /> : null}
            {field.type === "text" && !field.config?.multiline ? <input id={id} className={inputClass} value={String(value ?? "")} maxLength={field.config?.maxLength} disabled={!canEdit || busy} onChange={(event) => setValue(field, event.target.value)} /> : null}
            {field.type === "number" ? <input id={id} className={inputClass} type="number" inputMode="decimal" min={field.config?.min} max={field.config?.max} step={field.config?.step ?? "any"} value={typeof value === "number" || typeof value === "string" ? value : ""} disabled={!canEdit || busy} onChange={(event) => setValue(field, event.target.value === "" ? "" : Number(event.target.value))} /> : null}
            {field.type === "date" ? <input id={id} className={inputClass} type="date" value={typeof value === "string" ? value : ""} disabled={!canEdit || busy} onChange={(event) => setValue(field, event.target.value)} /> : null}
            {field.type === "select" ? <select id={id} className={inputClass} value={typeof value === "string" ? value : ""} disabled={!canEdit || busy} onChange={(event) => setValue(field, event.target.value)}><option value="">Selecione</option>{(field.config?.options ?? []).map((option) => <option value={option.id ?? option.value ?? option.label} key={option.id ?? option.value ?? option.label}>{option.label}</option>)}</select> : null}
            {field.type === "boolean" ? <div id={id} className="grid grid-cols-2 gap-2" tabIndex={-1}>{[{ label: "Sim", value: true }, { label: "Não", value: false }].map((option) => <button className={cx("min-h-12 rounded-xl border text-sm font-bold", value === option.value ? "border-[var(--violet)] bg-violet-100 text-[var(--violet-dark)]" : "border-[var(--line)] bg-white")} type="button" aria-pressed={value === option.value} disabled={!canEdit || busy} onClick={() => setValue(field, option.value)} key={option.label}>{option.label}</button>)}</div> : null}
            {field.type === "rating" ? <div id={id} className="grid grid-cols-6 gap-1.5 sm:grid-cols-11" tabIndex={-1}>{ratingChoices(field.config).map((rating) => <button className={cx("min-h-11 rounded-xl border text-xs font-bold", Number(value) === rating ? "border-[var(--violet)] bg-[var(--violet)] text-white" : "border-transparent bg-stone-100 hover:border-violet-300")} type="button" aria-pressed={Number(value) === rating} aria-label={`Nota ${String(rating).replace(".", ",")}`} disabled={!canEdit || busy} onClick={() => setValue(field, rating)} key={rating}>{String(rating).replace(".", ",")}</button>)}</div> : null}
          </div>
        );
      })}
      <StatusMessage error={error} success={success} />
      {canEdit ? <Button type="submit" className="w-full" disabled={busy}>{busy ? "Salvando…" : entry ? "Salvar alterações" : "Salvar registro"}<span aria-hidden="true">→</span></Button> : <p className="rounded-xl bg-stone-100 px-4 py-3 text-sm text-[var(--muted)]">Este desafio está encerrado. O registro está disponível somente para leitura.</p>}
      {item?.dueAt ? <p className="text-center text-xs text-[var(--muted)]">Prazo: {formatDateTime(item.dueAt)}</p> : null}
    </form>
  );
}

function ResultView({ challenge }: { challenge: ChallengeDetail }) {
  const result = challenge.result;
  const metrics = result?.metrics?.length ? result.metrics : challenge.metrics.filter((metric) => metric.visibleInResults);
  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[28px] bg-[var(--ink)] px-6 py-10 text-white sm:px-10 sm:py-14">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#aaa9a0]">{challenge.startsOn || challenge.endsOn ? `${formatDate(challenge.startsOn)} — ${formatDate(challenge.endsOn)}` : "Uma história do grupo"}</p>
        <h2 className="mt-4 max-w-3xl text-4xl font-semibold leading-none tracking-[-0.055em] sm:text-6xl">{result?.headline || challenge.title}</h2>
        {result?.summary ? <p className="mt-6 max-w-2xl text-base leading-7 text-[#c8c9c2]">{result.summary}</p> : null}
        <div className="mt-8 flex flex-wrap gap-2">{challenge.participants.map((participant) => <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs" key={participant.id}>{participant.name}</span>)}</div>
      </section>
      {metrics.length ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Resultados em números">
          {metrics.map((metric) => <article className={cx(cardClass, "p-5")} key={metric.id}><p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]">{metric.label}</p><strong className="mt-3 block text-4xl tracking-[-0.05em]">{metric.formattedValue ?? metric.value ?? "—"}</strong></article>)}
        </section>
      ) : <EmptyState title="A vitrine ainda está sendo preparada" description="Os registros estão preservados. Um administrador ainda pode escolher métricas e comentários para contar esta história." />}
      {result?.comments?.length ? (
        <section className={cx(cardClass, "p-6 sm:p-8")}><h2 className="text-xl font-bold">Momentos guardados</h2><div className="mt-5 grid gap-4 sm:grid-cols-2">{result.comments.map((comment) => <blockquote className="rounded-2xl bg-stone-100 p-5" key={comment.id}><p className="text-sm leading-6">“{comment.text}”</p><footer className="mt-3 text-xs font-bold text-[var(--muted)]">{comment.authorName ?? "Participante"}{comment.itemTitle ? ` · ${comment.itemTitle}` : ""}</footer></blockquote>)}</div></section>
      ) : null}
    </div>
  );
}

function ParticipantChallengeScreen({
  challenge,
  entries,
  user,
  tab,
  onTab,
  onBack,
  onAdmin,
  onSaveEntry,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  user: User;
  tab: ParticipantTab;
  onTab: (tab: ParticipantTab) => void;
  onBack: () => void;
  onAdmin?: () => void;
  onSaveEntry: (itemId: Id | null, values: Record<Id, unknown>, entry?: Entry) => Promise<void>;
}) {
  const ownEntries = entries.filter((entry) => !entry.userId || entry.userId === user.id);
  const entriesByItem = useMemo(() => new Map(ownEntries.map((entry) => [itemIdForEntry(entry), entry])), [ownEntries]);
  const sortedItems = useMemo(() => [...challenge.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)), [challenge.items]);
  const defaultItem = sortedItems.find((item) => item.status === "open" && !entriesByItem.has(item.id))
    ?? sortedItems.find((item) => !entriesByItem.has(item.id) && item.status !== "scheduled" && item.status !== "closed")
    ?? [...sortedItems].reverse().find((item) => entriesByItem.has(item.id))
    ?? sortedItems[0]
    ?? null;
  const [selectedItemId, setSelectedItemId] = useState<Id | null>(defaultItem?.id ?? null);
  const selectedItem = sortedItems.find((item) => item.id === selectedItemId) ?? defaultItem;
  const currentEntry = selectedItem ? entriesByItem.get(selectedItem.id) : ownEntries.find((entry) => !itemIdForEntry(entry));
  const completion = sortedItems.length ? Math.round((ownEntries.length / sortedItems.length) * 100) : 0;
  const tabs: Array<{ id: ParticipantTab; label: string }> = [
    { id: "today", label: "Hoje" },
    { id: "history", label: "Histórico" },
    { id: "progress", label: "Progresso" },
    { id: "results", label: "Resultado" },
  ];

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 pb-28 sm:px-6 sm:py-10">
      <div className="mb-5 flex items-center justify-between gap-3"><button className="min-h-11 text-sm font-bold text-[var(--muted)] hover:text-[var(--ink)]" type="button" onClick={onBack}>← Início</button>{onAdmin ? <Button variant="secondary" onClick={onAdmin}>Administrar</Button> : null}</div>
      <section className="relative overflow-hidden rounded-[28px] bg-[var(--ink)] p-6 text-white sm:p-9">
        <div className="relative z-10">
          <div className="flex flex-wrap items-center justify-between gap-3"><ChallengeStatusBadge status={challenge.status} /><span className="text-xs text-[#b8bbb3]">{formatDate(challenge.startsOn)} — {formatDate(challenge.endsOn)}</span></div>
          <h1 className="mt-10 max-w-3xl text-4xl font-semibold leading-none tracking-[-0.055em] sm:text-6xl">{challenge.title}</h1>
          {challenge.description ? <p className="mt-4 max-w-2xl text-sm leading-6 text-[#c8c9c2]">{challenge.description}</p> : null}
          {sortedItems.length ? <div className="mt-8 max-w-2xl"><div className="mb-2 flex justify-between text-xs text-[#c8c9c2]"><span><strong className="text-white">{ownEntries.length}</strong> de {sortedItems.length} registros</span><span>{completion}%</span></div><div className="h-2 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-[var(--coral)]" style={{ width: `${Math.min(100, completion)}%` }} /></div></div> : null}
        </div>
        <span className="absolute -right-28 -top-36 h-96 w-96 rounded-full border border-white/10" aria-hidden="true" />
      </section>

      <nav className="mt-5 hidden gap-1 rounded-2xl bg-stone-200/70 p-1 sm:flex" aria-label="Navegação do desafio">
        {tabs.map((item) => <button className={cx("min-h-11 flex-1 rounded-xl px-3 text-sm font-bold", tab === item.id ? "bg-white text-[var(--violet-dark)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]")} type="button" onClick={() => onTab(item.id)} key={item.id}>{item.label}</button>)}
      </nav>

      <div className="mt-5">
        {tab === "today" ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(290px,0.65fr)]">
            <section className={cx(cardClass, "p-5 sm:p-7")}>
              {challenge.status === "closed" ? <EmptyState title="Este desafio foi encerrado" description="Os registros foram preservados. Abra o resultado para rever a história do grupo." action={<Button onClick={() => onTab("results")}>Ver resultado</Button>} /> : challenge.submissionMode !== "free" && !selectedItem ? <EmptyState title="Nenhum checkpoint disponível" description="O próximo item aparecerá aqui quando for liberado pelo administrador." /> : (
                <>
                  <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--muted)]">{currentEntry ? "Seu registro" : "Próximo registro"}</p><h2 className="mt-2 text-2xl font-bold tracking-[-0.04em]">{selectedItem?.title ?? "Novo registro"}</h2>{selectedItem?.description ? <p className="mt-1 text-sm text-[var(--muted)]">{selectedItem.description}</p> : null}</div>{selectedItem?.dueAt ? <span className="rounded-full bg-stone-100 px-3 py-2 text-xs font-semibold text-[var(--muted)]">até {formatDateTime(selectedItem.dueAt)}</span> : null}</div>
                  <DynamicEntryForm key={`${selectedItem?.id ?? "free"}-${currentEntry?.id ?? "new"}`} fields={challenge.fields} item={selectedItem ?? null} entry={currentEntry} canEdit={challenge.status === "active" && challenge.isParticipant !== false && selectedItem?.status !== "scheduled" && selectedItem?.status !== "closed"} onSave={(values, entry) => onSaveEntry(selectedItem?.id ?? null, values, entry)} />
                </>
              )}
            </section>
            <aside className="space-y-5">
              {sortedItems.length > 1 ? <section className={cx(cardClass, "p-5")}><h2 className="text-base font-bold">Checkpoints</h2><label className="mt-3 block"><span className="sr-only">Escolher checkpoint</span><select className={inputClass} value={selectedItem?.id ?? ""} onChange={(event) => setSelectedItemId(event.target.value)}>{sortedItems.map((item, index) => <option value={item.id} key={item.id} disabled={item.status === "scheduled" && !entriesByItem.has(item.id)}>{entriesByItem.has(item.id) ? "✓ " : ""}{index + 1}. {item.title}{item.status === "scheduled" ? " (em breve)" : ""}</option>)}</select></label><ul className="mt-3 space-y-2 text-xs text-[var(--muted)]"><li>{ownEntries.length} concluídos</li><li>{Math.max(0, sortedItems.length - ownEntries.length)} pendentes</li></ul></section> : null}
              {challenge.rules ? <details className={cx(cardClass, "p-5")}><summary className="cursor-pointer text-sm font-bold">Regras do desafio</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">{challenge.rules}</p></details> : null}
            </aside>
          </div>
        ) : null}

        {tab === "history" ? (
          <section className={cx(cardClass, "p-5 sm:p-7")}><PageHeading title="Seus registros" description="Somente o que você enviou neste desafio." />{ownEntries.length ? <ul className="divide-y divide-[var(--line)]">{[...ownEntries].sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt))).map((entry) => { const item = sortedItems.find((candidate) => candidate.id === itemIdForEntry(entry)); const values = valuesAsRecord(entry.values); return <li className="py-5" key={entry.id}><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><strong>{item?.title ?? "Registro livre"}</strong><p className="mt-1 text-xs text-[var(--muted)]">{formatDateTime(entry.submittedAt ?? entry.updatedAt)}{entry.isLate ? " · enviado após o prazo" : ""}</p></div><dl className="grid gap-2 text-sm sm:grid-cols-2">{challenge.fields.map((field) => field.id && values[field.id] !== undefined ? <div className="rounded-lg bg-stone-100 px-3 py-2" key={field.id}><dt className="text-[10px] font-bold uppercase text-[var(--muted)]">{field.label}</dt><dd className="mt-1 font-semibold">{typeof values[field.id] === "boolean" ? values[field.id] ? "Sim" : "Não" : String(values[field.id])}</dd></div> : null)}</dl></div></li>; })}</ul> : <EmptyState title="Você ainda não registrou nada" description="Quando salvar o primeiro checkpoint, ele ficará guardado aqui." />}</section>
        ) : null}

        {tab === "progress" ? (
          <section><PageHeading title="Seu progresso" description="Métricas liberadas pelo administrador durante o desafio." />{challenge.metrics.filter((metric) => metric.visibleDuring).length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{challenge.metrics.filter((metric) => metric.visibleDuring).map((metric) => <article className={cx(cardClass, "p-6")} key={metric.id}><p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]">{metric.label}</p><strong className="mt-3 block text-4xl tracking-[-0.05em]">{metric.formattedValue ?? metric.value ?? "—"}</strong></article>)}</div> : <EmptyState title="Métricas ainda não publicadas" description="Seus registros continuam salvos. O administrador escolhe quais números ajudam o grupo durante o desafio." />}</section>
        ) : null}

        {tab === "results" ? challenge.status === "closed" || challenge.result ? <ResultView challenge={challenge} /> : <EmptyState title="A história ainda está acontecendo" description="O resultado final será liberado quando o desafio for encerrado." action={<Button onClick={() => onTab("today")}>Voltar ao registro</Button>} /> : null}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid h-[72px] grid-cols-4 border-t border-[var(--line)] bg-[rgba(255,253,248,0.96)] px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden" aria-label="Navegação mobile do desafio">
        {tabs.map((item) => <button className={cx("flex min-h-12 flex-col items-center justify-center gap-1 text-[10px] font-bold", tab === item.id ? "text-[var(--violet-dark)]" : "text-[var(--muted)]")} type="button" onClick={() => onTab(item.id)} key={item.id}><span className="text-base" aria-hidden="true">{item.id === "today" ? "●" : item.id === "history" ? "◷" : item.id === "progress" ? "↗" : "✦"}</span>{item.label}</button>)}
      </nav>
    </main>
  );
}

function AdminOverview({
  challenge,
  entries,
  onSave,
  onTransition,
  onDuplicate,
  onDelete,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  onSave: (payload: Partial<ChallengeSummary>) => Promise<void>;
  onTransition: (status: "active" | "closed") => Promise<void>;
  onDuplicate: (payload: { title: string }) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [title, setTitle] = useState(challenge.title);
  const [description, setDescription] = useState(challenge.description ?? "");
  const [rules, setRules] = useState(challenge.rules ?? "");
  const [startsOn, setStartsOn] = useState(challenge.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(challenge.endsOn ?? "");
  const [duplicateTitle, setDuplicateTitle] = useState(`${challenge.title} — cópia`);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const expected = challenge.items.length * challenge.participants.length;
  const missing = Math.max(0, expected - entries.length);

  async function run(label: string, action: () => Promise<void>, successText: string) {
    setBusy(label);
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(successText);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[{ label: "Participantes", value: challenge.participants.length }, { label: "Checkpoints", value: challenge.items.length }, { label: "Registros", value: entries.length }, { label: "Pendências", value: missing }].map((stat) => <article className={cx(cardClass, "p-5")} key={stat.label}><p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]">{stat.label}</p><strong className="mt-2 block text-4xl tracking-[-0.05em]">{stat.value}</strong></article>)}
      </div>

      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <h2 className="text-xl font-bold">Informações básicas</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Registros históricos nunca dependem da posição visual destes campos.</p>
        <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run("save", () => onSave({ title: title.trim(), description: description.trim(), rules: rules.trim(), startsOn, endsOn }), "Informações atualizadas."); }}>
          <label className="sm:col-span-2"><span className={labelClass}>Título</span><input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={140} disabled={challenge.status === "closed"} /></label>
          <label><span className={labelClass}>Início</span><input className={inputClass} type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} disabled={challenge.status !== "draft"} /></label>
          <label><span className={labelClass}>Término</span><input className={inputClass} type="date" min={startsOn} value={endsOn} onChange={(event) => setEndsOn(event.target.value)} disabled={challenge.status !== "draft"} /></label>
          <label className="sm:col-span-2"><span className={labelClass}>Descrição</span><textarea className={inputClass} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} disabled={challenge.status === "closed"} /></label>
          <label className="sm:col-span-2"><span className={labelClass}>Regras</span><textarea className={inputClass} rows={5} value={rules} onChange={(event) => setRules(event.target.value)} maxLength={5000} disabled={challenge.status === "closed"} /></label>
          {challenge.status !== "closed" ? <div className="sm:col-span-2"><Button type="submit" disabled={busy === "save"}>{busy === "save" ? "Salvando…" : "Salvar informações"}</Button></div> : null}
        </form>
      </section>

      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <h2 className="text-xl font-bold">Estado do desafio</h2>
        <div className="mt-4 flex flex-col gap-4 rounded-2xl bg-stone-100 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div><ChallengeStatusBadge status={challenge.status} /><p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">{challenge.status === "draft" ? "Somente administradores veem este rascunho. Confira campos, checkpoints e participantes antes de ativar." : challenge.status === "active" ? "Participantes podem enviar e editar seus registros. Encerrar bloqueia os dados de origem." : "Registros e estrutura estão congelados; a curadoria da vitrine ainda pode ser atualizada."}</p></div>
          {challenge.status === "draft" ? <Button disabled={Boolean(busy)} onClick={() => { if (window.confirm("Ativar este desafio? Participantes selecionados poderão registrar.")) void run("transition", () => onTransition("active"), "Desafio ativado."); }}>Ativar desafio</Button> : null}
          {challenge.status === "active" ? <Button variant="danger" disabled={Boolean(busy)} onClick={() => { if (window.confirm("Encerrar o desafio? Os registros serão bloqueados e esta ação não poderá ser desfeita no MVP.")) void run("transition", () => onTransition("closed"), "Desafio encerrado."); }}>Encerrar desafio</Button> : null}
        </div>
      </section>

      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <h2 className="text-xl font-bold">Duplicar com segurança</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--muted)]">Cria um novo rascunho neste grupo com regras, campos, métricas e checkpoints. Não copia participantes, registros, comentários selecionados nem auditoria.</p>
        <form className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto]" onSubmit={(event) => { event.preventDefault(); void run("duplicate", () => onDuplicate({ title: duplicateTitle.trim() }), "Cópia criada como rascunho."); }}>
          <label><span className={labelClass}>Novo título</span><input className={inputClass} value={duplicateTitle} onChange={(event) => setDuplicateTitle(event.target.value)} required maxLength={140} /></label>
          <div className="flex items-end"><Button type="submit" variant="secondary" disabled={busy === "duplicate"}>{busy === "duplicate" ? "Duplicando…" : "Criar cópia"}</Button></div>
        </form>
      </section>

      {onDelete ? (
        <section className={cx(cardClass, "p-5 sm:p-7")}>
          <h2 className="text-xl font-bold">Apagar desafio</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">Move o desafio e seus registros para a lixeira. Some do app, mas continua recuperável até você limpar a lixeira na administração.</p>
          <div className="mt-4"><Button variant="danger" disabled={Boolean(busy)} onClick={() => { if (window.confirm(`Mover "${challenge.title}" para a lixeira?`)) void run("delete", onDelete, "Desafio movido para a lixeira."); }}>Apagar desafio</Button></div>
        </section>
      ) : null}
      <StatusMessage error={error} success={success} />
    </div>
  );
}

function AdminParticipants({
  challenge,
  group,
  onSave,
}: {
  challenge: ChallengeDetail;
  group?: GroupSummary;
  onSave: (participantIds: Id[]) => Promise<void>;
}) {
  const initial = challenge.participants.map((participant) => participant.userId ?? participant.id);
  const [selected, setSelected] = useState<Id[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  return (
    <section className={cx(cardClass, "p-5 sm:p-7")}>
      <PageHeading title="Participantes" description="Membros do grupo podem conhecer o desafio; somente os selecionados enviam registros." />
      {group?.members?.length ? (
        <div className="grid gap-3 sm:grid-cols-2">{group.members.map((member) => { const checked = selected.includes(member.id); return <label className={cx("flex min-h-16 items-center gap-3 rounded-xl border bg-white px-4", checked ? "border-violet-300" : "border-[var(--line)]")} key={member.id}><input type="checkbox" aria-label={`Selecionar ${member.name}`} checked={checked} disabled={challenge.status === "closed" || busy} onChange={(event) => setSelected((current) => event.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id))} /><span><strong className="block text-sm">{member.name}</strong><small className="text-[var(--muted)]">@{member.username} · {member.role}</small></span></label>; })}</div>
      ) : <EmptyState title="Lista de membros indisponível" description="O bootstrap precisa incluir os membros do grupo para que a seleção seja editada aqui." />}
      <div className="mt-5"><StatusMessage error={error} success={success} /></div>
      {challenge.status !== "closed" && group?.members?.length ? <Button className="mt-5" disabled={busy} onClick={() => { setBusy(true); setError(null); setSuccess(null); onSave(selected).then(() => setSuccess("Participantes atualizados.")).catch((cause: unknown) => setError(errorMessage(cause))).finally(() => setBusy(false)); }}>{busy ? "Salvando…" : "Salvar participantes"}</Button> : null}
    </section>
  );
}

function AdminFields({
  challenge,
  onSave,
}: {
  challenge: ChallengeDetail;
  onSave: (fields: ChallengeField[]) => Promise<void>;
}) {
  const [fields, setFields] = useState(challenge.fields);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  return (
    <section className={cx(cardClass, "p-5 sm:p-7")}>
      <PageHeading title="Campos do registro" description={challenge.status === "draft" ? "Tipos e ordem podem ser ajustados antes da ativação." : "Campos persistidos mantêm seu identificador; remoções são tratadas como arquivamento pelo servidor."} />
      <FieldBuilder fields={fields} onChange={setFields} lockPersistedTypes={challenge.status !== "draft"} />
      <div className="mt-5"><StatusMessage error={error} success={success} /></div>
      <Button className="mt-5" disabled={busy || challenge.status !== "draft"} onClick={() => { setBusy(true); setError(null); setSuccess(null); onSave(cleanFields(fields)).then(() => setSuccess("Campos salvos.")).catch((cause: unknown) => setError(errorMessage(cause))).finally(() => setBusy(false)); }}>{busy ? "Salvando…" : "Salvar campos"}</Button>
    </section>
  );
}

function AdminItems({
  challenge,
  onAdd,
  onUpdate,
}: {
  challenge: ChallengeDetail;
  onAdd: (payload: Record<string, unknown>) => Promise<void>;
  onUpdate: (itemId: Id, payload: { title: string; description: string }) => Promise<void>;
}) {
  const [itemsText, setItemsText] = useState("");
  const startsOn = challenge.startsOn ?? "";
  const endsOn = challenge.endsOn ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<Id | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState<string | null>(null);

  function startEditing(item: ChallengeItem) {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditDescription(item.description ?? "");
    setEditError(null);
    setEditSuccess(null);
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>, itemId: Id) {
    event.preventDefault();
    setEditBusy(true);
    setEditError(null);
    setEditSuccess(null);
    try {
      await onUpdate(itemId, { title: editTitle.trim(), description: editDescription.trim() });
      setEditingId(null);
      setEditSuccess(challenge.submissionMode === "daily" ? "Checkpoint atualizado." : "Item atualizado.");
    } catch (cause) {
      setEditError(errorMessage(cause));
    } finally {
      setEditBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const titles = itemsText.split("\n").map((item) => item.trim()).filter(Boolean);
    if (challenge.submissionMode !== "daily" && !titles.length) { setError("Adicione pelo menos um item."); return; }
    setBusy(true); setError(null); setSuccess(null);
    try {
      await onAdd(challenge.submissionMode === "daily"
        ? { generate: { frequency: "daily", startsOn, endsOn } }
        : { items: titles.map((title, index) => ({ title, position: challenge.items.length + index })) });
      setItemsText("");
      setSuccess(challenge.submissionMode === "daily" ? "Checkpoints diários gerados." : "Itens adicionados.");
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <PageHeading title="Itens e checkpoints" description="Edite títulos e descrições sem trocar os identificadores usados nos registros. Depois do encerramento, o histórico fica bloqueado." />
        {editSuccess ? <div className="mb-3"><StatusMessage success={editSuccess} /></div> : null}
        {challenge.items.length ? (
          <ol className="divide-y divide-[var(--line)]">
            {[...challenge.items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((item, index) => (
              <li className="py-4" key={item.id}>
                {editingId === item.id ? (
                  <form className="grid gap-3" onSubmit={(event) => void submitEdit(event, item.id)}>
                    <div className="flex items-center gap-3">
                      <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-stone-100 text-xs font-bold text-[var(--muted)]">{index + 1}</span>
                      <strong className="text-sm">Editar {challenge.submissionMode === "daily" ? "checkpoint" : "item"}</strong>
                    </div>
                    <label><span className={labelClass}>Título</span><input className={inputClass} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} required maxLength={challenge.submissionMode === "daily" ? 160 : 200} /></label>
                    <label><span className={labelClass}>Descrição</span><textarea className={inputClass} rows={3} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} maxLength={2000} placeholder="Contexto opcional" /></label>
                    <StatusMessage error={editError} />
                    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={editBusy}>{editBusy ? "Salvando…" : "Salvar"}</Button><Button variant="ghost" disabled={editBusy} onClick={() => { setEditingId(null); setEditError(null); }}>Cancelar</Button></div>
                  </form>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 gap-3">
                      <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-stone-100 text-xs font-bold text-[var(--muted)]">{index + 1}</span>
                      <span className="min-w-0"><strong className="block text-sm">{item.title}</strong>{item.description ? <span className="mt-1 block text-sm leading-6 text-[var(--muted)]">{item.description}</span> : null}<small className="mt-1 block text-[var(--muted)]">{item.date ? formatDate(item.date) : item.opensAt || item.dueAt ? `${formatDate(item.opensAt)} — ${formatDate(item.dueAt)}` : "sem janela definida"}</small></span>
                    </div>
                    <div className="flex flex-none flex-col items-end gap-2"><span className="rounded-full bg-stone-100 px-2 py-1 text-[10px] font-bold uppercase text-[var(--muted)]">{item.status ?? "planejado"}</span>{challenge.status !== "closed" ? <Button variant="secondary" className="min-h-9 px-3 py-1 text-xs" onClick={() => startEditing(item)}>Editar</Button> : null}</div>
                  </div>
                )}
              </li>
            ))}
          </ol>
        ) : <EmptyState title="Nenhum checkpoint" description="Adicione itens ou gere checkpoints diários antes de ativar o desafio." />}
      </section>
      <aside className={cx(cardClass, "h-fit p-5")}>
        <h2 className="text-lg font-bold">{challenge.submissionMode === "daily" ? "Gerar dias" : "Adicionar itens"}</h2>
        {challenge.status !== "draft" ? <p className="mt-4 text-sm leading-6 text-[var(--muted)]">Novos itens e datas ficam bloqueados depois da ativação. Títulos e descrições ainda podem ser corrigidos até o encerramento.</p> : <form className="mt-4 space-y-4" onSubmit={submit}>
          {challenge.submissionMode === "daily" ? <><p className="text-xs leading-5 text-[var(--muted)]">A geração usa exatamente as datas definidas nas informações básicas.</p><label><span className={labelClass}>Primeiro dia</span><input className={inputClass} type="date" value={startsOn} readOnly required /></label><label><span className={labelClass}>Último dia</span><input className={inputClass} type="date" min={startsOn} value={endsOn} readOnly required /></label></> : <label><span className={labelClass}>Um título por linha</span><textarea className={inputClass} rows={10} value={itemsText} onChange={(event) => setItemsText(event.target.value)} placeholder={"Item 1\nItem 2"} /></label>}
          <StatusMessage error={error} success={success} />
          <Button type="submit" className="w-full" disabled={busy || challenge.status !== "draft"}>{busy ? "Salvando…" : challenge.submissionMode === "daily" ? "Gerar checkpoints" : "Adicionar"}</Button>
        </form>}
      </aside>
    </div>
  );
}

function AdminReview({
  challenge,
  entries,
  onPatch,
  onExport,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  onPatch: (entryId: Id, values: Record<Id, unknown>, reason: string) => Promise<void>;
  onExport: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [lateOnly, setLateOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const [reason, setReason] = useState("");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filtered = entries.filter((entry) => {
    const item = challenge.items.find((candidate) => candidate.id === itemIdForEntry(entry));
    const haystack = `${entry.participantName ?? ""} ${entry.participantUsername ?? ""} ${item?.title ?? ""}`.toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) && (!lateOnly || entry.isLate);
  });
  const selected = entries.find((entry) => entry.id === selectedId);
  const selectedItem = challenge.items.find((item) => item.id === (selected ? itemIdForEntry(selected) : null)) ?? null;
  const expected = challenge.items.length * challenge.participants.length;

  return (
    <div className="space-y-6">
      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <PageHeading title="Revisão dos registros" description={`${entries.length} enviados · ${Math.max(0, expected - entries.length)} pendentes · ${entries.filter((entry) => entry.isLate).length} após o prazo`} action={<Button variant="secondary" disabled={exporting} onClick={() => { setExporting(true); setError(null); onExport().catch((cause: unknown) => setError(errorMessage(cause))).finally(() => setExporting(false)); }}>{exporting ? "Preparando…" : "Exportar CSV"}</Button>} />
        <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_auto]">
          <label><span className="sr-only">Buscar registros</span><input className={inputClass} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar pessoa ou checkpoint" /></label>
          <label className="flex min-h-12 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 text-sm font-semibold"><input type="checkbox" checked={lateOnly} onChange={(event) => setLateOnly(event.target.checked)} />Somente atrasados</label>
        </div>
        <StatusMessage error={error} />
        {filtered.length ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {filtered.map((entry) => {
              const item = challenge.items.find((candidate) => candidate.id === itemIdForEntry(entry));
              const values = valuesAsRecord(entry.values);
              return (
                <article className="rounded-2xl border border-[var(--line)] bg-white p-4" key={entry.id}>
                  <div className="flex items-start justify-between gap-3"><div><strong className="block">{entry.participantName ?? entry.participantUsername ?? "Participante"}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{item?.title ?? "Registro livre"} · {formatDateTime(entry.submittedAt ?? entry.updatedAt)}</span></div>{entry.isLate ? <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold uppercase text-amber-900">atrasado</span> : null}</div>
                  <dl className="mt-4 grid gap-2 sm:grid-cols-2">{challenge.fields.slice(0, 4).map((field) => field.id && values[field.id] !== undefined ? <div className="rounded-lg bg-stone-100 px-3 py-2" key={field.id}><dt className="text-[10px] font-bold uppercase text-[var(--muted)]">{field.label}</dt><dd className="mt-1 truncate text-sm font-semibold">{typeof values[field.id] === "boolean" ? values[field.id] ? "Sim" : "Não" : String(values[field.id])}</dd></div> : null)}</dl>
                  <Button className="mt-4 w-full" variant="secondary" onClick={() => { setSelectedId(entry.id); setReason(""); }}>Inspecionar e corrigir</Button>
                </article>
              );
            })}
          </div>
        ) : <EmptyState title="Nenhum registro encontrado" description={entries.length ? "Ajuste os filtros para ver outros registros." : "Os envios dos participantes aparecerão aqui."} />}
      </section>

      {selected ? (
        <section className={cx(cardClass, "p-5 sm:p-7")} aria-labelledby="correction-title">
          <div className="mb-5 flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]">Correção administrativa</p><h2 id="correction-title" className="mt-1 text-xl font-bold">{selected.participantName ?? "Participante"} · {selectedItem?.title ?? "Registro"}</h2></div><Button variant="ghost" onClick={() => setSelectedId(null)}>Fechar</Button></div>
          <label className="mb-5 block"><span className={labelClass}>Motivo da alteração <span className="text-[var(--coral)]">*</span></span><textarea className={inputClass} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explique por que o registro está sendo corrigido. Isto ficará na auditoria." maxLength={500} disabled={challenge.status === "closed"} /></label>
          <DynamicEntryForm key={`${selected.id}-${selected.updatedAt ?? ""}`} fields={challenge.fields} item={selectedItem} entry={selected} canEdit={challenge.status !== "closed"} onSave={async (values) => { if (!reason.trim()) throw new Error("Informe o motivo da correção administrativa."); await onPatch(selected.id, values, reason.trim()); setReason(""); }} />
        </section>
      ) : null}
    </div>
  );
}

function AdminMetrics({
  challenge,
  onAdd,
}: {
  challenge: ChallengeDetail;
  onAdd: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [operation, setOperation] = useState<Metric["operation"]>("average");
  const [fieldId, setFieldId] = useState("");
  const [groupBy, setGroupBy] = useState<Metric["groupBy"]>("none");
  const [visibleDuring, setVisibleDuring] = useState(true);
  const [visibleInResults, setVisibleInResults] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const needsNumericField = ["sum", "average", "min", "max"].includes(operation);
  const selectableFields = challenge.fields.filter((field) => !needsNumericField || field.type === "number" || field.type === "rating");
  const needsField = operation !== "count" && operation !== "completion_rate";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (needsField && !fieldId) { setError("Escolha um campo compatível."); return; }
    setBusy(true); setError(null); setSuccess(null);
    try {
      await onAdd({ label: label.trim(), operation, fieldId: needsField ? fieldId : null, groupBy, visibleDuring, visibleInResults });
      setLabel("");
      setSuccess("Métrica adicionada e recalculada sem alterar os registros.");
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section>
        <PageHeading title="Métricas" description="Operações conhecidas referenciam IDs estáveis de campos, nunca sua posição na tela." />
        {challenge.metrics.length ? <div className="grid gap-3 sm:grid-cols-2">{challenge.metrics.map((metric) => <article className={cx(cardClass, "p-5")} key={metric.id}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]">{metric.operation.replace("_", " ")}</p><h3 className="mt-1 font-bold">{metric.label}</h3></div><strong className="text-2xl tracking-[-0.04em]">{metric.formattedValue ?? metric.value ?? "—"}</strong></div><div className="mt-4 flex flex-wrap gap-2 text-[10px] font-bold uppercase text-[var(--muted)]">{metric.visibleDuring ? <span className="rounded-full bg-emerald-100 px-2 py-1">durante</span> : null}{metric.visibleInResults ? <span className="rounded-full bg-violet-100 px-2 py-1">resultado</span> : null}{metric.groupBy && metric.groupBy !== "none" ? <span className="rounded-full bg-stone-100 px-2 py-1">por {metric.groupBy}</span> : null}</div></article>)}</div> : <EmptyState title="Nenhuma métrica configurada" description="Comece com contagem, média ou taxa de conclusão. Fórmulas arbitrárias ficam fora do MVP." />}
      </section>
      <aside className={cx(cardClass, "h-fit p-5")}>
        <h2 className="text-lg font-bold">Adicionar métrica</h2>
        {challenge.status === "closed" ? <p className="mt-4 text-sm leading-6 text-[var(--muted)]">As métricas foram congeladas no encerramento para preservar o resultado histórico.</p> : <form className="mt-4 space-y-4" onSubmit={submit}>
          <label><span className={labelClass}>Nome</span><input className={inputClass} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ex.: Média do grupo" required maxLength={100} /></label>
          <label><span className={labelClass}>Operação</span><select className={inputClass} value={operation} onChange={(event) => { const next = event.target.value as Metric["operation"]; setOperation(next); setFieldId(""); }}><option value="sum">Soma</option><option value="average">Média</option><option value="count">Contagem</option><option value="min">Mínimo</option><option value="max">Máximo</option><option value="completion_rate">Taxa de conclusão</option></select></label>
          {needsField ? <label><span className={labelClass}>Campo</span><select className={inputClass} value={fieldId} onChange={(event) => setFieldId(event.target.value)} required><option value="">Selecione</option>{selectableFields.filter((field) => field.id).map((field) => <option value={field.id} key={field.id}>{field.label}</option>)}</select></label> : null}
          <label><span className={labelClass}>Agrupar</span><select className={inputClass} value={groupBy} onChange={(event) => setGroupBy(event.target.value as Metric["groupBy"])}><option value="none">Sem agrupamento</option><option value="participant">Por participante</option><option value="item">Por item/checkpoint</option></select></label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={visibleDuring} onChange={(event) => setVisibleDuring(event.target.checked)} />Mostrar durante o desafio</label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={visibleInResults} onChange={(event) => setVisibleInResults(event.target.checked)} />Disponível na vitrine final</label>
          <StatusMessage error={error} success={success} />
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Calculando…" : "Adicionar métrica"}</Button>
        </form>}
      </aside>
    </div>
  );
}

interface CuratedCommentCandidate {
  key: string;
  entryId: Id;
  fieldId: Id;
  authorName: string;
  itemTitle: string;
  text: string;
}

function AdminResults({
  challenge,
  entries,
  onSave,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [headline, setHeadline] = useState(challenge.result?.headline ?? challenge.title);
  const [summary, setSummary] = useState(challenge.result?.summary ?? "");
  const [metricIds, setMetricIds] = useState<Id[]>(challenge.result?.metrics?.map((metric) => metric.id) ?? challenge.metrics.filter((metric) => metric.visibleInResults).map((metric) => metric.id));
  const [commentKeys, setCommentKeys] = useState<string[]>(
    challenge.result?.comments?.flatMap((comment) => comment.entryId && comment.fieldId ? [`${comment.entryId}:${comment.fieldId}`] : []) ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const textFields = challenge.fields.filter((field) => field.id && field.type === "text");
  const candidates = useMemo(() => {
    const result: CuratedCommentCandidate[] = [];
    for (const entry of entries) {
      const values = valuesAsRecord(entry.values);
      for (const field of textFields) {
        if (!field.id || typeof values[field.id] !== "string" || !String(values[field.id]).trim()) continue;
        const item = challenge.items.find((candidate) => candidate.id === itemIdForEntry(entry));
        result.push({ key: `${entry.id}:${field.id}`, entryId: entry.id, fieldId: field.id, authorName: entry.participantName ?? "Participante", itemTitle: item?.title ?? "Registro", text: String(values[field.id]).trim() });
      }
    }
    return result;
  }, [challenge.items, entries, textFields]);

  async function save() {
    setBusy(true); setError(null); setSuccess(null);
    try {
      await onSave({
        headline: headline.trim(),
        summary: summary.trim(),
        metricIds,
        comments: candidates.filter((candidate) => commentKeys.includes(candidate.key)).map(({ entryId, fieldId }) => ({ entryId, fieldId })),
      });
      setSuccess("Vitrine salva.");
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <section className={cx(cardClass, "p-5 sm:p-7")}>
        <PageHeading title="Curadoria da vitrine" description="Os cálculos são automáticos; você escolhe o que ajuda a contar a história." />
        <div className="grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className={labelClass}>Manchete</span><input className={inputClass} value={headline} onChange={(event) => setHeadline(event.target.value)} maxLength={180} /></label><label className="sm:col-span-2"><span className={labelClass}>Resumo</span><textarea className={inputClass} rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={1500} /></label></div>
        <fieldset className="mt-6"><legend className="text-base font-bold">Métricas em destaque</legend>{challenge.metrics.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{challenge.metrics.map((metric) => <label className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--line)] bg-white px-4 text-sm" key={metric.id}><input type="checkbox" aria-label={`Destacar métrica ${metric.label}`} checked={metricIds.includes(metric.id)} onChange={(event) => setMetricIds((current) => event.target.checked ? [...current, metric.id] : current.filter((id) => id !== metric.id))} /><span><strong className="block">{metric.label}</strong><small className="text-[var(--muted)]">{metric.formattedValue ?? metric.value ?? "sem valor"}</small></span></label>)}</div> : <p className="mt-2 text-sm text-[var(--muted)]">Crie métricas antes de selecioná-las.</p>}</fieldset>
        <fieldset className="mt-6"><legend className="text-base font-bold">Comentários selecionados</legend>{candidates.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{candidates.map((candidate) => <label className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-white p-4 text-sm" key={candidate.key}><input className="mt-1" type="checkbox" aria-label={`Selecionar comentário de ${candidate.authorName}`} checked={commentKeys.includes(candidate.key)} onChange={(event) => setCommentKeys((current) => event.target.checked ? [...current, candidate.key] : current.filter((key) => key !== candidate.key))} /><span><span className="line-clamp-3 leading-6">“{candidate.text}”</span><small className="mt-2 block font-bold text-[var(--muted)]">{candidate.authorName} · {candidate.itemTitle}</small></span></label>)}</div> : <p className="mt-2 text-sm text-[var(--muted)]">Nenhum campo de texto preenchido está disponível para curadoria.</p>}</fieldset>
        <div className="mt-5"><StatusMessage error={error} success={success} /></div>
        <Button className="mt-5" disabled={busy} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar vitrine"}</Button>
      </section>
      {challenge.result || challenge.status === "closed" ? <section><PageHeading title="Como o grupo verá" description="Prévia da vitrine com a curadoria atual." /><ResultView challenge={challenge} /></section> : <EmptyState title="Prévia disponível após salvar" description="Você pode preparar a curadoria durante o desafio e publicar o resultado ao encerrá-lo." />}
    </div>
  );
}

function AdminScreen({
  challenge,
  entries,
  group,
  tab,
  onTab,
  onBack,
  onViewParticipant,
  onSaveBasics,
  onTransition,
  onDuplicate,
  onDelete,
  onSaveParticipants,
  onSaveFields,
  onAddItems,
  onUpdateItem,
  onPatchEntry,
  onExport,
  onAddMetric,
  onSaveResult,
}: {
  challenge: ChallengeDetail;
  entries: Entry[];
  group?: GroupSummary;
  tab: AdminTab;
  onTab: (tab: AdminTab) => void;
  onBack: () => void;
  onViewParticipant: () => void;
  onSaveBasics: (payload: Partial<ChallengeSummary>) => Promise<void>;
  onTransition: (status: "active" | "closed") => Promise<void>;
  onDuplicate: (payload: { title: string }) => Promise<void>;
  onDelete?: () => Promise<void>;
  onSaveParticipants: (ids: Id[]) => Promise<void>;
  onSaveFields: (fields: ChallengeField[]) => Promise<void>;
  onAddItems: (payload: Record<string, unknown>) => Promise<void>;
  onUpdateItem: (itemId: Id, payload: { title: string; description: string }) => Promise<void>;
  onPatchEntry: (entryId: Id, values: Record<Id, unknown>, reason: string) => Promise<void>;
  onExport: () => Promise<void>;
  onAddMetric: (payload: Record<string, unknown>) => Promise<void>;
  onSaveResult: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const tabs: Array<{ id: AdminTab; label: string }> = [
    { id: "overview", label: "Visão geral" },
    { id: "participants", label: "Pessoas" },
    { id: "fields", label: "Campos" },
    { id: "items", label: "Checkpoints" },
    { id: "review", label: "Revisão" },
    { id: "metrics", label: "Métricas" },
    { id: "results", label: "Vitrine" },
  ];
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 pb-24 sm:px-6 sm:py-10">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><button className="min-h-11 text-sm font-bold text-[var(--muted)] hover:text-[var(--ink)]" type="button" onClick={onBack}>← {group?.name ?? "Início"}</button><Button variant="secondary" onClick={onViewParticipant}>Ver como participante</Button></div>
      <PageHeading title={challenge.title} description="Configure, revise e apresente — controles administrativos continuam validados no servidor." action={<ChallengeStatusBadge status={challenge.status} />} />
      <nav className="mb-6 flex gap-1 overflow-x-auto rounded-2xl bg-stone-200/70 p-1" aria-label="Áreas administrativas">{tabs.map((item) => <button className={cx("min-h-11 flex-none rounded-xl px-4 text-sm font-bold", tab === item.id ? "bg-white text-[var(--violet-dark)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]")} type="button" onClick={() => onTab(item.id)} key={item.id}>{item.label}</button>)}</nav>
      {tab === "overview" ? <AdminOverview challenge={challenge} entries={entries} onSave={onSaveBasics} onTransition={onTransition} onDuplicate={onDuplicate} onDelete={onDelete} /> : null}
      {tab === "participants" ? <AdminParticipants key={`${challenge.id}:${challenge.participants.map((participant) => participant.userId ?? participant.id).join(",")}`} challenge={challenge} group={group} onSave={onSaveParticipants} /> : null}
      {tab === "fields" ? <AdminFields key={`${challenge.id}:${challenge.fields.map((field) => field.id ?? field.key).join(",")}`} challenge={challenge} onSave={onSaveFields} /> : null}
      {tab === "items" ? <AdminItems challenge={challenge} onAdd={onAddItems} onUpdate={onUpdateItem} /> : null}
      {tab === "review" ? <AdminReview challenge={challenge} entries={entries} onPatch={onPatchEntry} onExport={onExport} /> : null}
      {tab === "metrics" ? <AdminMetrics challenge={challenge} onAdd={onAddMetric} /> : null}
      {tab === "results" ? <AdminResults challenge={challenge} entries={entries} onSave={onSaveResult} /> : null}
    </main>
  );
}

export default function GoaApp() {
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(null);
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
    apiRequest<BootstrapData | { bootstrap: BootstrapData }>(API_PATHS.bootstrap, { signal: controller.signal })
      .then((raw) => {
        if (!active) return;
        const data = normalizeBootstrap(raw);
        if (inviteToken) setPendingInviteToken(inviteToken);
        setBootstrap(data);
        setScreen(inviteToken ? { kind: "invite", token: inviteToken } : data.user ? { kind: "dashboard" } : { kind: "auth", mode: "login" });
      })
      .catch((cause: unknown) => {
        if (!active || (cause instanceof DOMException && cause.name === "AbortError")) return;
        setBootError(errorMessage(cause));
      });
    return () => { active = false; controller.abort(); };
  }, []);

  async function refreshBootstrap(): Promise<BootstrapData> {
    const raw = await apiRequest<BootstrapData | { bootstrap: BootstrapData }>(API_PATHS.bootstrap);
    const data = normalizeBootstrap(raw);
    setBootstrap(data);
    return data;
  }

  async function loadChallenge(challengeId: Id): Promise<ChallengeDetail> {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const [rawChallenge, rawEntries] = await Promise.all([
        apiRequest<ChallengeDetail | { challenge: ChallengeDetail }>(API_PATHS.challenge(challengeId)),
        apiRequest<Entry[] | { entries: Entry[] }>(API_PATHS.entries(challengeId)),
      ]);
      const challenge = normalizeChallenge(rawChallenge);
      setSelectedChallenge(challenge);
      setEntries(normalizeEntries(rawEntries));
      return challenge;
    } catch (cause) {
      setDetailError(errorMessage(cause));
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
    setScreen(pendingInviteToken ? { kind: "invite", token: pendingInviteToken } : { kind: "dashboard" });
  }

  async function logout() {
    if (!bootstrap) return;
    await apiRequest(API_PATHS.auth.logout, { method: "POST", body: {}, csrfToken: bootstrap.csrfToken });
    const data = await refreshBootstrap();
    setSelectedChallenge(null);
    setEntries([]);
    setScreen({ kind: "auth", mode: "login" });
    if (data.user) throw new Error("Não foi possível encerrar a sessão.");
  }

  async function openParticipant(challengeId: Id, requestedTab?: ParticipantTab) {
    const summary = bootstrap?.challenges.find((challenge) => challenge.id === challengeId);
    const tab = requestedTab ?? (summary?.status === "closed" ? "results" : "today");
    setScreen({ kind: "challenge", challengeId, tab });
    try { await loadChallenge(challengeId); } catch { /* O erro detalhado é renderizado no estado da tela. */ }
  }

  async function openAdmin(challengeId: Id, tab: AdminTab = "overview") {
    setScreen({ kind: "admin", challengeId, tab });
    try { await loadChallenge(challengeId); } catch { /* O erro detalhado é renderizado no estado da tela. */ }
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
        rules: input.rules,
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
    await openAdmin(challengeId);
  }

  async function mutateChallenge(path: string, body: unknown, method: "POST" | "PATCH" = "POST") {
    if (!bootstrap) return;
    await apiRequest(path, { method, body, csrfToken: bootstrap.csrfToken });
    await Promise.all([reloadSelected(), refreshBootstrap()]);
  }

  async function duplicateChallenge(payload: { title: string }) {
    if (!bootstrap || !selectedChallenge) return;
    const response = await apiRequest<unknown>(API_PATHS.duplicate(selectedChallenge.id), { method: "POST", body: payload, csrfToken: bootstrap.csrfToken });
    const challengeId = normalizeCreatedId(response);
    await refreshBootstrap();
    if (challengeId) await openAdmin(challengeId);
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
          <h1 className="mt-6 text-2xl font-bold">Não foi possível abrir o Goa</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{bootError}</p>
          <Button className="mt-6" onClick={() => window.location.reload()}>Tentar novamente</Button>
        </section>
      </main>
    );
  }
  if (!bootstrap || screen.kind === "loading") return <LoadingView />;

  if (!bootstrap.user) {
    if (screen.kind === "invite") {
      return <InviteScreen token={screen.token} user={null} csrfToken={bootstrap.csrfToken} onBack={() => setScreen({ kind: "auth", mode: "login" })} onNeedAuth={() => setScreen({ kind: "auth", mode: "login" })} onAccepted={async () => undefined} />;
    }
    return <AuthScreen initialMode={screen.kind === "auth" ? screen.mode : "login"} invitePending={Boolean(pendingInviteToken)} onAuthenticated={authenticate} onShowInvite={pendingInviteToken ? () => setScreen({ kind: "invite", token: pendingInviteToken }) : undefined} />;
  }

  const user = bootstrap.user;
  const selectedGroup = screen.kind === "group" || screen.kind === "create-challenge"
    ? bootstrap.groups.find((group) => group.id === screen.groupId)
    : selectedChallenge ? bootstrap.groups.find((group) => group.id === selectedChallenge.groupId) : undefined;
  const selectedRole = selectedChallenge?.viewerRole ?? selectedGroup?.role;

  let content: ReactNode;
  if (screen.kind === "invite") {
    content = <InviteScreen key={screen.token} token={screen.token} user={user} csrfToken={bootstrap.csrfToken} onBack={() => setScreen({ kind: "dashboard" })} onNeedAuth={() => undefined} onAccepted={async () => { await refreshBootstrap(); setPendingInviteToken(null); window.history.replaceState({}, "", window.location.pathname); setScreen({ kind: "dashboard" }); }} />;
  } else if (screen.kind === "group" && selectedGroup) {
    content = <GroupScreen key={selectedGroup.id} group={selectedGroup} challenges={bootstrap.challenges.filter((challenge) => challenge.groupId === selectedGroup.id)} onBack={() => setScreen({ kind: "dashboard" })} onCreateChallenge={() => setScreen({ kind: "create-challenge", groupId: selectedGroup.id })} onOpenChallenge={(id) => void openParticipant(id)} onOpenAdmin={(id) => void openAdmin(id)} onCreateInvite={async (payload) => apiRequest<{ token?: string; url?: string }>(API_PATHS.groupInvites(selectedGroup.id), { method: "POST", body: payload, csrfToken: bootstrap.csrfToken })} onUpdateGroup={(payload) => updateGroup(selectedGroup.id, payload)} onDeleteGroup={selectedGroup.role === "owner" ? () => deleteGroup(selectedGroup.id) : undefined} />;
  } else if (screen.kind === "create-challenge" && selectedGroup && canManage(selectedGroup.role)) {
    content = <CreateChallengeScreen key={selectedGroup.id} group={selectedGroup} onBack={() => setScreen({ kind: "group", groupId: selectedGroup.id })} onCreate={(input) => createChallenge(selectedGroup.id, input)} />;
  } else if ((screen.kind === "challenge" || screen.kind === "admin") && (detailLoading || !selectedChallenge || selectedChallenge.id !== screen.challengeId)) {
    content = detailError ? <main className="mx-auto max-w-2xl px-5 py-16"><EmptyState title="Não foi possível abrir este desafio" description={detailError} action={<Button onClick={() => screen.kind === "admin" ? void openAdmin(screen.challengeId, screen.tab) : void openParticipant(screen.challengeId, screen.tab)}>Tentar novamente</Button>} /></main> : <LoadingView label="Carregando o desafio…" />;
  } else if (screen.kind === "challenge" && selectedChallenge) {
    content = <ParticipantChallengeScreen key={selectedChallenge.id} challenge={selectedChallenge} entries={entries} user={user} tab={screen.tab} onTab={(tab) => setScreen({ ...screen, tab })} onBack={() => setScreen({ kind: "dashboard" })} onAdmin={canManage(selectedRole) ? () => void openAdmin(selectedChallenge.id) : undefined} onSaveEntry={saveEntry} />;
  } else if (screen.kind === "admin" && selectedChallenge && canManage(selectedRole)) {
    content = <AdminScreen key={selectedChallenge.id} challenge={selectedChallenge} entries={entries} group={selectedGroup} tab={screen.tab} onTab={(tab) => setScreen({ ...screen, tab })} onBack={() => selectedGroup ? setScreen({ kind: "group", groupId: selectedGroup.id }) : setScreen({ kind: "dashboard" })} onViewParticipant={() => setScreen({ kind: "challenge", challengeId: selectedChallenge.id, tab: selectedChallenge.status === "closed" ? "results" : "today" })} onSaveBasics={(payload) => mutateChallenge(API_PATHS.challenge(selectedChallenge.id), payload, "PATCH")} onTransition={(status) => mutateChallenge(API_PATHS.transition(selectedChallenge.id), { status })} onDuplicate={duplicateChallenge} onDelete={canManage(selectedRole) ? () => deleteChallenge(selectedChallenge.id, selectedGroup?.id) : undefined} onSaveParticipants={(participantIds) => mutateChallenge(API_PATHS.participants(selectedChallenge.id), { replace: true, participantIds })} onSaveFields={(fields) => mutateChallenge(API_PATHS.fields(selectedChallenge.id), { replace: true, archiveMissing: true, fields })} onAddItems={(payload) => mutateChallenge(API_PATHS.items(selectedChallenge.id), payload)} onUpdateItem={(itemId, payload) => mutateChallenge(API_PATHS.item(selectedChallenge.id, itemId), payload, "PATCH")} onPatchEntry={(entryId, values, reason) => mutateChallenge(API_PATHS.entry(entryId), { values, reason }, "PATCH")} onExport={exportCsv} onAddMetric={(payload) => mutateChallenge(API_PATHS.metrics(selectedChallenge.id), payload)} onSaveResult={(payload) => mutateChallenge(API_PATHS.results(selectedChallenge.id), payload)} />;
  } else if (screen.kind === "admin" || screen.kind === "create-challenge") {
    content = <main className="mx-auto max-w-2xl px-5 py-16"><EmptyState title="Acesso administrativo indisponível" description="Você não possui papel de responsável ou administrador neste grupo. O servidor também valida cada operação." action={<Button onClick={() => setScreen({ kind: "dashboard" })}>Voltar ao início</Button>} /></main>;
  } else {
    content = <DashboardScreen user={user} groups={bootstrap.groups} challenges={bootstrap.challenges} onOpenGroup={(groupId) => setScreen({ kind: "group", groupId })} onOpenChallenge={(id) => void openParticipant(id)} onOpenAdmin={(id) => void openAdmin(id)} onCreateGroup={createGroup} onOpenInvite={(token) => { setPendingInviteToken(token); setScreen({ kind: "invite", token }); }} />;
  }

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <AppHeader user={user} onHome={() => setScreen({ kind: "dashboard" })} onLogout={logout} />
      {content}
    </div>
  );
}
