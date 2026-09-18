"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { Brand } from "../goa/ui";

type Tab = "usage" | "insights" | "feedback" | "accounts";

interface Overview {
  users: { total: number; newThisWeek: number; disabled: number };
  groups: { active: number; activeLast30Days: number; trashed: number };
  challenges: { active: number; inProgress: number; usedLast30Days: number; trashed: number };
  entries: { active: number; trashed: number };
  auditEvents: number;
  storage: { databaseBytes: number; tables: Array<{ name: string; bytes: number }> };
}
interface Insights {
  windowDays: number;
  includesStaff: boolean;
  definitions: Record<string, string>;
  overview: {
    challengesTotal: number; challengesInProgress: number; challengesUsedInWindow: number;
    groupsTotal: number; groupsUsedInWindow: number; accountsNewInWindow: number; accountsWithEntryInWindow: number;
    weekly: Array<{ week: string; accountsCreated: number; challengesCreated: number; entriesRecorded: number }>;
  };
  creation: {
    challengesCreated: number; copiedFromTemplate: number; copiedFromChallenge: number;
    byRecipe: Array<{ recipe: string; count: number }>;
    customization: { librariesCreated: number; sharedResponseTypesCreated: number; externalRecommendersSaved: number; itemsScheduled: number };
    firstRecord: { challengesCreated: number; withFirstRecord: number; medianHoursToFirstRecord: number | null };
    returnUsage: { peopleWithRecords: number; peopleOnMultipleDays: number };
  };
  problems: {
    feedbackCount: number; blocked: number; didNotWork: number; averageEase: number | null;
    byImpact: Array<{ impact: string; count: number }>;
  };
}
interface AuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  actor: string | null;
  before: unknown;
  after: unknown;
}
interface AdminUser {
  id: string;
  name: string;
  username: string;
  email: string | null;
  createdAt: string;
  disabledAt: string | null;
  deletedAt: string | null;
  platformAdmin: boolean;
  lastSeenAt: string | null;
  groupsOwned: number;
  activeSessions: number;
}
interface FeedbackItem {
  id: string;
  createdAt: string;
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
  appVersion: string | null;
  contact: string | null;
  username: string | null;
}

const card = "rounded-[20px] border border-[var(--line)] bg-[var(--paper)] shadow-[0_1px_2px_rgba(32,36,31,0.04)]";
const muted = "text-[var(--muted)]";

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
}) {
  const tones = {
    primary: "border-transparent bg-[var(--main)] text-white hover:opacity-90",
    secondary: "border-[var(--line)] bg-transparent text-[var(--ink)] hover:bg-black/[0.04]",
    danger: "border-[var(--danger-line)] bg-transparent text-[var(--danger)] hover:bg-[var(--danger-soft)]",
    ghost: "border-transparent bg-transparent text-[var(--muted)] hover:bg-black/[0.04] hover:text-[var(--ink)]",
  };
  return (
    <button
      className={cx(
        "inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-55",
        tones[variant],
      )}
      type="button"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.message ?? "Falha ao carregar.");
  return body as T;
}

export default function AdminConsole({ viewerId, viewerName, csrfToken }: { viewerId: string; viewerName: string; csrfToken: string }) {
  const [tab, setTab] = useState<Tab>("usage");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [insightDays, setInsightDays] = useState(30);
  const [insightStaff, setInsightStaff] = useState(false);
  const [audit, setAudit] = useState<AuditEvent[] | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [feedback, setFeedback] = useState<FeedbackItem[] | null>(null);
  const [auditEntity, setAuditEntity] = useState("");

  const post = useCallback(
    async (path: string, payload: unknown) => {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message ?? "Falha na operação.");
      return body;
    },
    [csrfToken],
  );

  const loadOverview = useCallback(() => apiGet<Overview>("/api/admin/overview").then(setOverview), []);
  const loadInsights = useCallback(
    () => apiGet<Insights>(`/api/admin/insights?days=${insightDays}${insightStaff ? "&includeStaff=1" : ""}`).then(setInsights),
    [insightDays, insightStaff],
  );
  const loadUsers = useCallback(
    () => apiGet<{ users: AdminUser[] }>("/api/admin/users").then((data) => setUsers(data.users)),
    [],
  );
  const loadFeedback = useCallback(
    () => apiGet<{ items: FeedbackItem[] }>("/api/admin/feedback").then((data) => setFeedback(data.items)),
    [],
  );
  const loadAudit = useCallback(
    (entityId?: string) =>
      apiGet<{ events: AuditEvent[] }>(`/api/admin/audit?limit=150${entityId ? `&entityId=${encodeURIComponent(entityId)}` : ""}`)
        .then((data) => setAudit(data.events)),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const loader =
      tab === "usage" ? () => Promise.all([loadOverview(), loadInsights()])
      : tab === "insights" ? loadInsights
      : tab === "feedback" ? () => Promise.all([loadFeedback(), loadInsights()])
      : () => Promise.all([loadUsers(), loadAudit(), loadOverview()]);
    loader()
      .then(() => { if (!cancelled) setError(null); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Falha ao carregar."); });
    return () => { cancelled = true; };
  }, [tab, loadOverview, loadInsights, loadAudit, loadUsers, loadFeedback]);

  async function run(action: () => Promise<unknown>, reload: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await Promise.all([reload(), loadOverview()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha na operação.");
    } finally {
      setBusy(false);
    }
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "usage", label: "Visão geral" },
    { id: "insights", label: "Criação e uso" },
    { id: "feedback", label: "Problemas e feedback" },
    { id: "accounts", label: "Contas e operação" },
  ];

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-[var(--edge)] bg-[var(--canvas)]/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link className="inline-flex items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25" href="/">
            <Brand />
            <span className={cx("text-sm font-light", muted)}>Gestão</span>
          </Link>
          <div className="flex items-center gap-4">
            <span className={cx("hidden text-sm sm:inline", muted)}>{viewerName}</span>
            <Link className={cx("text-sm font-light", muted, "hover:text-[var(--ink)]")} href="/">← Voltar ao app</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <p className={cx("mb-8 text-sm", muted)}>Gestão interna · Somente metadados — nunca o conteúdo dos grupos.</p>

      <nav className="mb-6 flex gap-1 overflow-x-auto rounded-2xl bg-black/[0.04] p-1" aria-label="Seções da administração">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cx(
              "min-h-10 flex-none rounded-xl px-4 text-sm font-light transition",
              tab === item.id ? "bg-[var(--paper)] text-[var(--main-strong)] shadow-sm" : cx(muted, "hover:text-[var(--ink)]"),
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {error ? (
        <div className="mb-5 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger-strong)]" role="alert">{error}</div>
      ) : null}

      {tab === "usage" ? <UsageTab overview={overview} insights={insights} /> : null}
      {tab === "insights" ? (
        <InsightsTab
          insights={insights}
          days={insightDays}
          includeStaff={insightStaff}
          onDays={setInsightDays}
          onIncludeStaff={setInsightStaff}
        />
      ) : null}
      {tab === "feedback" ? <FeedbackTab items={feedback} problems={insights?.problems ?? null} /> : null}
      {tab === "accounts" ? (
        <div className="space-y-10">
          <AccountsTab
            users={users}
            viewerId={viewerId}
            busy={busy}
            onDisable={(user, disabled) =>
              run(() => post("/api/admin/users/disable", { userId: user.id, disabled }), loadUsers)
            }
            onSetAdmin={(user, platformAdmin) =>
              run(() => post("/api/admin/users/set-admin", { userId: user.id, platformAdmin }), loadUsers)
            }
            onRevoke={(user) =>
              run(() => post("/api/admin/users/revoke-sessions", { userId: user.id }), loadUsers)
            }
          />
          <AuditTab
            events={audit}
            entity={auditEntity}
            onEntity={(value) => { setAuditEntity(value); loadAudit(value || undefined); }}
          />
          <StorageSection overview={overview} />
        </div>
      ) : null}
      </main>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <article className={cx(card, "p-5")}>
      <p className={cx("text-xs font-light", muted)}>{label}</p>
      <strong className="mt-2 block text-3xl tracking-[-0.04em]">{value}</strong>
      {hint ? <p className={cx("mt-1 text-xs", muted)}>{hint}</p> : null}
    </article>
  );
}

function UsageTab({ overview, insights }: { overview: Overview | null; insights: Insights | null }) {
  if (!overview) return <p className={cx("text-sm", muted)}>Carregando…</p>;
  const window = insights?.windowDays ?? 30;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Usuários" value={overview.users.total} hint={`+${overview.users.newThisWeek} nos últimos 7 dias · ${overview.users.disabled} desativados`} />
        <Stat label="Grupos" value={overview.groups.active} hint={`${overview.groups.activeLast30Days} com registro nos últimos 30 dias · ${overview.groups.trashed} na lixeira`} />
        <Stat
          label="Desafios (não excluídos)"
          value={overview.challenges.active}
          hint={`${overview.challenges.inProgress} em andamento · ${overview.challenges.usedLast30Days} com registro nos últimos 30 dias · ${overview.challenges.trashed} na lixeira`}
        />
        <Stat label="Registros" value={overview.entries.active} hint={`${overview.entries.trashed} na lixeira`} />
      </div>
      <p className={cx("text-xs", muted)}>
        Um desafio não excluído pode ser rascunho, encerrado ou parado há meses — “em andamento” e “com registro recente” dizem mais sobre uso de verdade.
      </p>
      {insights ? (
        <section className={cx(card, "p-5 sm:p-6")}>
          <h2 className="text-lg font-light">Últimas 8 semanas</h2>
          <p className={cx("mt-1 text-xs", muted)}>
            Ações confirmadas pelo servidor{insights.includesStaff ? "" : ", sem contas da equipe"}. Janela dos números acima: {window} dias.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className={cx("text-left text-xs", muted)}>
                  <th className="py-2 font-light">Semana de</th>
                  <th className="py-2 text-right font-light">Contas novas</th>
                  <th className="py-2 text-right font-light">Desafios criados</th>
                  <th className="py-2 text-right font-light">Registros</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {insights.overview.weekly.map((row) => (
                  <tr key={row.week}>
                    <td className="py-2">{row.week}</td>
                    <td className="py-2 text-right tabular-nums">{row.accountsCreated}</td>
                    <td className="py-2 text-right tabular-nums">{row.challengesCreated}</td>
                    <td className="py-2 text-right tabular-nums">{row.entriesRecorded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function StorageSection({ overview }: { overview: Overview | null }) {
  if (!overview) return null;
  const maxBytes = Math.max(1, ...overview.storage.tables.map((table) => table.bytes));
  return (
    <section className={cx(card, "p-5 sm:p-6")}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-light">Armazenamento</h2>
        <span className="text-sm font-light">{formatBytes(overview.storage.databaseBytes)}</span>
      </div>
      <p className={cx("mt-1 text-xs", muted)}>{overview.auditEvents} eventos de auditoria.</p>
      <ul className="mt-4 space-y-2">
        {overview.storage.tables.map((table) => (
          <li key={table.name} className="grid grid-cols-[1fr_auto] items-center gap-3">
            <div>
              <div className="flex justify-between text-xs">
                <span className="font-medium">{table.name}</span>
                <span className={muted}>{formatBytes(table.bytes)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
                <span className="block h-full rounded-full bg-[var(--main)]" style={{ width: `${(table.bytes / maxBytes) * 100}%` }} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function InsightRow({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <li className="flex items-baseline justify-between gap-4 py-2.5">
      <span className="min-w-0">
        <span className="text-sm">{label}</span>
        {hint ? <span className={cx("block text-xs", muted)}>{hint}</span> : null}
      </span>
      <strong className="flex-none text-base font-normal tabular-nums">{value}</strong>
    </li>
  );
}

function InsightsTab({
  insights, days, includeStaff, onDays, onIncludeStaff,
}: {
  insights: Insights | null;
  days: number;
  includeStaff: boolean;
  onDays: (value: number) => void;
  onIncludeStaff: (value: boolean) => void;
}) {
  const controls = (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <label className="flex items-center gap-2">
        <span className={muted}>Janela</span>
        <select className="min-h-10 rounded-full border border-[var(--line)] bg-[var(--paper)] px-4" value={days} onChange={(event) => onDays(Number(event.target.value))}>
          <option value={7}>7 dias</option>
          <option value={30}>30 dias</option>
          <option value={90}>90 dias</option>
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={includeStaff} onChange={(event) => onIncludeStaff(event.target.checked)} />
        <span className={muted}>Incluir contas da equipe (seeds e testes)</span>
      </label>
    </div>
  );
  if (!insights) return <div className="space-y-4">{controls}<p className={cx("text-sm", muted)}>Carregando…</p></div>;
  const { creation, definitions } = insights;
  const fromScratch = Math.max(0, creation.challengesCreated - creation.copiedFromTemplate - creation.copiedFromChallenge);
  const hours = creation.firstRecord.medianHoursToFirstRecord;
  return (
    <div className="space-y-6">
      {controls}
      <p className={cx("text-xs", muted)}>{definitions.confirmed} {definitions.privacy}</p>

      <section className={cx(card, "p-5 sm:p-6")}>
        <h2 className="text-lg font-light">Criar ou copiar</h2>
        <ul className="mt-2 divide-y divide-[var(--line)]">
          <InsightRow label="Desafios criados" value={creation.challengesCreated} hint={definitions.created} />
          <InsightRow label="Do zero" value={fromScratch} />
          <InsightRow label="Copiados de um modelo público" value={creation.copiedFromTemplate} hint={definitions.copied} />
          <InsightRow label="Copiados de outro desafio" value={creation.copiedFromChallenge} />
        </ul>
        {creation.byRecipe.length ? (
          <>
            <h3 className={cx("mt-4 text-xs font-light", muted)}>Por modelo</h3>
            <ul className="mt-1 divide-y divide-[var(--line)]">
              {creation.byRecipe.map((row) => <InsightRow key={row.recipe} label={row.recipe} value={row.count} />)}
            </ul>
          </>
        ) : null}
      </section>

      <section className={cx(card, "p-5 sm:p-6")}>
        <h2 className="text-lg font-light">Personalização</h2>
        <p className={cx("mt-1 text-xs", muted)}>{definitions.customization}</p>
        <ul className="mt-2 divide-y divide-[var(--line)]">
          <InsightRow label="Bibliotecas criadas" value={creation.customization.librariesCreated} />
          <InsightRow label="Respostas compartilhadas criadas" value={creation.customization.sharedResponseTypesCreated} />
          <InsightRow label="Indicadores externos salvos" value={creation.customization.externalRecommendersSaved} />
          <InsightRow label="Itens com agenda definida" value={creation.customization.itemsScheduled} />
        </ul>
      </section>

      <section className={cx(card, "p-5 sm:p-6")}>
        <h2 className="text-lg font-light">Primeiro registro e retorno</h2>
        <ul className="mt-2 divide-y divide-[var(--line)]">
          <InsightRow
            label="Desafios criados que já têm registro"
            value={`${creation.firstRecord.withFirstRecord} de ${creation.firstRecord.challengesCreated}`}
            hint={definitions.firstRecord}
          />
          <InsightRow label="Mediana até o primeiro registro" value={hours === null ? "—" : `${hours} h`} />
          <InsightRow
            label="Pessoas com registro em 2+ dias"
            value={`${creation.returnUsage.peopleOnMultipleDays} de ${creation.returnUsage.peopleWithRecords}`}
            hint={definitions.returnUsage}
          />
        </ul>
      </section>
    </div>
  );
}


function AuditTab({
  events,
  entity,
  onEntity,
}: {
  events: AuditEvent[] | null;
  entity: string;
  onEntity: (value: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="min-h-9 w-full max-w-sm rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 text-sm outline-none focus:border-[var(--main)]"
          placeholder="Filtrar por ID de entidade"
          value={entity}
          onChange={(event) => onEntity(event.target.value.trim())}
        />
        {entity ? <Button variant="ghost" onClick={() => onEntity("")}>Limpar</Button> : null}
      </div>
      {!events ? (
        <p className={cx("text-sm", muted)}>Carregando…</p>
      ) : !events.length ? (
        <div className={cx(card, "p-8 text-center text-sm", muted)}>Nenhum evento.</div>
      ) : (
        <ul className="space-y-2">
          {events.map((event) => (
            <li key={event.id} className={cx(card, "p-4 text-sm")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <code className="rounded bg-black/[0.06] px-1.5 py-0.5 text-xs font-light">{event.action}</code>
                  <span className={cx("text-xs", muted)}>{event.entityType} · {event.entityId}</span>
                </div>
                <span className={cx("text-xs", muted)}>{event.actor ? `@${event.actor}` : "sistema"} · {formatDateTime(event.createdAt)}</span>
              </div>
              {event.before || event.after ? (
                <pre className="mt-2 overflow-x-auto rounded-lg bg-black/[0.04] p-2 text-[11px] leading-5">
                  {JSON.stringify({ before: event.before, after: event.after }, null, 2)}
                </pre>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const IMPACT_LABEL: Record<string, string> = {
  blocked: "bloqueou",
  effort: "deu trabalho",
  minor: "incômodo pequeno",
  idea: "ideia futura",
};

function FeedbackTab({ items, problems }: { items: FeedbackItem[] | null; problems: Insights["problems"] | null }) {
  if (!items) return <p className={cx("text-sm", muted)}>Carregando…</p>;
  const summary = problems ? (
    <section className={cx(card, "mb-4 p-5 sm:p-6")}>
      <h2 className="text-lg font-light">Dificuldades relatadas</h2>
      <p className={cx("mt-1 text-xs", muted)}>
        Só o que as pessoas contaram no feedback: mostra atrito, não prova se gostam do produto. Operações que falharam não são
        registradas — este painel ainda não mostra erros do servidor.
      </p>
      <ul className="mt-2 divide-y divide-[var(--line)]">
        <InsightRow label="Feedbacks na janela" value={problems.feedbackCount} />
        <InsightRow label="Bloqueou de vez" value={problems.blocked} />
        <InsightRow label="Não conseguiu fazer o que queria" value={problems.didNotWork} />
        <InsightRow label="Facilidade média (1–5)" value={problems.averageEase ?? "—"} />
      </ul>
    </section>
  ) : null;
  if (!items.length) return <>{summary}<div className={cx(card, "p-8 text-center text-sm", muted)}>Nenhum feedback ainda.</div></>;
  return (
    <>
    {summary}
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className={cx(card, "p-4 text-sm")}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-black/[0.06] px-2 py-0.5 text-[10px] font-light">{IMPACT_LABEL[item.impact] ?? item.impact}</span>
            <strong>{item.area}</strong>
            {item.succeeded === false ? <span className="rounded-full bg-[var(--danger-soft)] px-1.5 py-0.5 text-[10px] font-light text-[var(--danger)]">não conseguiu</span> : null}
            {item.ease != null ? <span className={cx("text-xs", muted)}>facilidade {item.ease}/5</span> : null}
          </div>
          <p className="mt-2 leading-6">{item.goal}</p>
          {item.friction ? <p className={cx("mt-1 leading-6", muted)}><span className="font-medium">Atrapalhou:</span> {item.friction}</p> : null}
          {item.wish ? <p className={cx("mt-1 leading-6", muted)}><span className="font-medium">Pediu:</span> {item.wish}</p> : null}
          {item.workaround ? <p className={cx("mt-1", muted)}>Hoje resolve com: {item.workaround}</p> : null}
          <p className={cx("mt-2 text-xs", muted)}>
            {item.username ? `@${item.username}` : "anônimo"} · {formatDateTime(item.createdAt)}
            {item.route ? ` · ${item.route}` : ""}{item.locale ? ` · ${item.locale}` : ""}
            {item.contact ? ` · contato: ${item.contact}` : ""}
          </p>
        </li>
      ))}
    </ul>
    </>
  );
}

function AccountsTab({
  users,
  viewerId,
  busy,
  onDisable,
  onSetAdmin,
  onRevoke,
}: {
  users: AdminUser[] | null;
  viewerId: string;
  busy: boolean;
  onDisable: (user: AdminUser, disabled: boolean) => void;
  onSetAdmin: (user: AdminUser, platformAdmin: boolean) => void;
  onRevoke: (user: AdminUser) => void;
}) {
  if (!users) return <p className={cx("text-sm", muted)}>Carregando…</p>;


  return (
    <div className="space-y-2">
      {users.map((user) => {
        return (
          <article key={user.id} className={cx(card, "p-4", user.disabledAt && "opacity-60")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{user.name}</strong>
                  {user.platformAdmin ? <span className="rounded-full bg-black/[0.06] px-1.5 py-0.5 text-[10px] font-light">admin</span> : null}
                  {user.deletedAt ? <span className="rounded-full bg-[var(--danger-soft)] px-1.5 py-0.5 text-[10px] font-light text-[var(--danger)]">removida</span> : user.disabledAt ? <span className="rounded-full bg-[var(--danger-soft)] px-1.5 py-0.5 text-[10px] font-light text-[var(--danger)]">desativada</span> : null}
                </div>
                <p className={cx("mt-1 text-xs", muted)}>
                  @{user.username}{user.email ? ` · ${user.email}` : " · sem e-mail"} · criada {formatDateTime(user.createdAt)} · última sessão {formatDateTime(user.lastSeenAt)} · {user.groupsOwned} grupos · {user.activeSessions} sessões
                </p>
              </div>
              {user.id === viewerId ? (
                <span className={cx("text-xs", muted)}>você</span>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      const to = !user.platformAdmin;
                      if (window.confirm(to ? `Dar acesso de administração a ${user.name}?` : `Remover o acesso de administração de ${user.name}?`)) onSetAdmin(user, to);
                    }}
                  >
                    {user.platformAdmin ? "Remover admin" : "Tornar admin"}
                  </Button>
                  <Button variant="ghost" disabled={busy || !user.activeSessions} onClick={() => onRevoke(user)}>Revogar sessões</Button>
                  {user.platformAdmin ? null : (
                    <Button variant={user.disabledAt ? "secondary" : "danger"} disabled={busy} onClick={() => onDisable(user, !user.disabledAt)}>
                      {user.disabledAt ? "Reativar" : "Desativar"}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
