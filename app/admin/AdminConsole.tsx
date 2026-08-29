"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useState } from "react";

type Tab = "usage" | "trash" | "audit" | "accounts";

interface Overview {
  users: { total: number; newThisWeek: number; disabled: number };
  groups: { active: number; trashed: number };
  challenges: { active: number; trashed: number };
  entries: { active: number; trashed: number };
  auditEvents: number;
  storage: { databaseBytes: number; tables: Array<{ name: string; bytes: number }> };
}
interface TrashItem {
  kind: "group" | "challenge" | "entry";
  id: string;
  label: string;
  deletedAt: string;
  deletedBy: string | null;
  childCount: number;
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
  platformAdmin: boolean;
  lastSeenAt: string | null;
  groupsOwned: number;
  activeSessions: number;
  pendingReset: { expiresAt: string } | null;
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
        "inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-55",
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

export default function AdminConsole({ viewerName, csrfToken }: { viewerName: string; csrfToken: string }) {
  const [tab, setTab] = useState<Tab>("usage");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [trash, setTrash] = useState<TrashItem[] | null>(null);
  const [audit, setAudit] = useState<AuditEvent[] | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
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
  const loadTrash = useCallback(
    () => apiGet<{ items: TrashItem[] }>("/api/admin/trash").then((data) => setTrash(data.items)),
    [],
  );
  const loadUsers = useCallback(
    () => apiGet<{ users: AdminUser[] }>("/api/admin/users").then((data) => setUsers(data.users)),
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
      tab === "usage" ? loadOverview
      : tab === "trash" ? loadTrash
      : tab === "audit" ? () => loadAudit()
      : loadUsers;
    loader()
      .then(() => { if (!cancelled) setError(null); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Falha ao carregar."); });
    return () => { cancelled = true; };
  }, [tab, loadOverview, loadTrash, loadAudit, loadUsers]);

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
    { id: "usage", label: "Uso" },
    { id: "trash", label: "Lixeira" },
    { id: "audit", label: "Auditoria" },
    { id: "accounts", label: "Contas" },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-[-0.045em]">Administração</h1>
          <p className={cx("mt-1 text-sm", muted)}>Área privada · {viewerName}. Somente metadados — nunca o conteúdo dos grupos.</p>
        </div>
        <Link className={cx("text-sm font-bold", muted, "hover:text-[var(--ink)]")} href="/">← Voltar ao app</Link>
      </header>

      <nav className="mb-6 flex gap-1 overflow-x-auto rounded-2xl bg-black/[0.04] p-1" aria-label="Seções da administração">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cx(
              "min-h-10 flex-none rounded-xl px-4 text-sm font-bold transition",
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

      {tab === "usage" ? <UsageTab overview={overview} /> : null}
      {tab === "trash" ? (
        <TrashTab
          items={trash}
          busy={busy}
          onPurge={(item) =>
            run(() => post("/api/admin/trash/purge", { kind: item.kind, id: item.id }), loadTrash)
          }
          onInspect={(item) => { setAuditEntity(item.id); setTab("audit"); loadAudit(item.id); }}
        />
      ) : null}
      {tab === "audit" ? (
        <AuditTab
          events={audit}
          entity={auditEntity}
          onEntity={(value) => { setAuditEntity(value); loadAudit(value || undefined); }}
        />
      ) : null}
      {tab === "accounts" ? (
        <AccountsTab
          users={users}
          busy={busy}
          onDisable={(user, disabled) =>
            run(() => post("/api/admin/users/disable", { userId: user.id, disabled }), loadUsers)
          }
          onRevoke={(user) =>
            run(() => post("/api/admin/users/revoke-sessions", { userId: user.id }), loadUsers)
          }
          onResetLink={(user) =>
            post("/api/admin/users/reset-link", { userId: user.id }) as Promise<{ url: string; expiresAt: string }>
          }
        />
      ) : null}
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <article className={cx(card, "p-5")}>
      <p className={cx("text-xs font-bold uppercase tracking-[0.1em]", muted)}>{label}</p>
      <strong className="mt-2 block text-3xl tracking-[-0.04em]">{value}</strong>
      {hint ? <p className={cx("mt-1 text-xs", muted)}>{hint}</p> : null}
    </article>
  );
}

function UsageTab({ overview }: { overview: Overview | null }) {
  if (!overview) return <p className={cx("text-sm", muted)}>Carregando…</p>;
  const maxBytes = Math.max(1, ...overview.storage.tables.map((table) => table.bytes));
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Usuários" value={overview.users.total} hint={`+${overview.users.newThisWeek} nos últimos 7 dias · ${overview.users.disabled} desativados`} />
        <Stat label="Grupos ativos" value={overview.groups.active} hint={`${overview.groups.trashed} na lixeira`} />
        <Stat label="Desafios ativos" value={overview.challenges.active} hint={`${overview.challenges.trashed} na lixeira`} />
        <Stat label="Registros" value={overview.entries.active} hint={`${overview.entries.trashed} na lixeira · ${overview.auditEvents} eventos de auditoria`} />
      </div>
      <section className={cx(card, "p-5 sm:p-6")}>
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold">Armazenamento</h2>
          <span className="text-sm font-bold">{formatBytes(overview.storage.databaseBytes)}</span>
        </div>
        <ul className="mt-4 space-y-2">
          {overview.storage.tables.map((table) => (
            <li key={table.name} className="grid grid-cols-[1fr_auto] items-center gap-3">
              <div>
                <div className="flex justify-between text-xs">
                  <span className="font-semibold">{table.name}</span>
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
    </div>
  );
}

function TrashTab({
  items,
  busy,
  onPurge,
  onInspect,
}: {
  items: TrashItem[] | null;
  busy: boolean;
  onPurge: (item: TrashItem) => void;
  onInspect: (item: TrashItem) => void;
}) {
  if (!items) return <p className={cx("text-sm", muted)}>Carregando…</p>;
  if (!items.length) return <div className={cx(card, "p-8 text-center text-sm", muted)}>A lixeira está vazia.</div>;
  const kindLabel = { group: "Grupo", challenge: "Desafio", entry: "Registro" };
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={`${item.kind}:${item.id}`} className={cx(card, "flex flex-wrap items-center justify-between gap-3 p-4")}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-black/[0.06] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">{kindLabel[item.kind]}</span>
              <strong className="truncate">{item.label}</strong>
            </div>
            <p className={cx("mt-1 text-xs", muted)}>
              apagado {formatDateTime(item.deletedAt)}{item.deletedBy ? ` por @${item.deletedBy}` : ""}
              {item.kind !== "entry" ? ` · ${item.childCount} ${item.kind === "group" ? "desafios" : "registros"} embutidos` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onInspect(item)}>Auditoria</Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => { if (window.confirm(`Excluir "${item.label}" definitivamente? Não há como recuperar.`)) onPurge(item); }}
            >
              Excluir definitivo
            </Button>
          </div>
        </li>
      ))}
    </ul>
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
                  <code className="rounded bg-black/[0.06] px-1.5 py-0.5 text-xs font-bold">{event.action}</code>
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

function AccountsTab({
  users,
  busy,
  onDisable,
  onRevoke,
  onResetLink,
}: {
  users: AdminUser[] | null;
  busy: boolean;
  onDisable: (user: AdminUser, disabled: boolean) => void;
  onRevoke: (user: AdminUser) => void;
  onResetLink: (user: AdminUser) => Promise<{ url: string; expiresAt: string }>;
}) {
  const [links, setLinks] = useState<Record<string, { url: string; expiresAt: string }>>({});
  const [linkBusy, setLinkBusy] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  if (!users) return <p className={cx("text-sm", muted)}>Carregando…</p>;

  async function generate(user: AdminUser) {
    setLinkBusy(user.id);
    setLinkError(null);
    try {
      const generated = await onResetLink(user);
      setLinks((current) => ({ ...current, [user.id]: generated }));
    } catch (cause) {
      setLinkError(cause instanceof Error ? cause.message : "Falha ao gerar o link.");
    } finally {
      setLinkBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      {linkError ? <div className="rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger-strong)]">{linkError}</div> : null}
      {users.map((user) => {
        const link = links[user.id];
        return (
          <article key={user.id} className={cx(card, "p-4", user.disabledAt && "opacity-60")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{user.name}</strong>
                  {user.platformAdmin ? <span className="rounded-full bg-black/[0.06] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">admin</span> : null}
                  {user.disabledAt ? <span className="rounded-full bg-[var(--danger-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--danger)]">desativada</span> : null}
                  {user.pendingReset ? <span className="rounded-full bg-[var(--warn-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--warn)]">reset pedido</span> : null}
                </div>
                <p className={cx("mt-1 text-xs", muted)}>
                  @{user.username}{user.email ? ` · ${user.email}` : " · sem e-mail"} · criada {formatDateTime(user.createdAt)} · última sessão {formatDateTime(user.lastSeenAt)} · {user.groupsOwned} grupos · {user.activeSessions} sessões
                </p>
              </div>
              {user.platformAdmin ? (
                <span className={cx("text-xs", muted)}>protegida</span>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" disabled={!!linkBusy || !user.email} onClick={() => generate(user)}>
                    {linkBusy === user.id ? "Gerando…" : "Gerar link de senha"}
                  </Button>
                  <Button variant="ghost" disabled={busy || !user.activeSessions} onClick={() => onRevoke(user)}>Revogar sessões</Button>
                  <Button variant={user.disabledAt ? "secondary" : "danger"} disabled={busy} onClick={() => onDisable(user, !user.disabledAt)}>
                    {user.disabledAt ? "Reativar" : "Desativar"}
                  </Button>
                </div>
              )}
            </div>
            {link ? (
              <div className="mt-3 rounded-xl bg-black/[0.04] p-3">
                <p className={cx("text-[11px] font-bold uppercase tracking-wide", muted)}>Link de uso único · expira {formatDateTime(link.expiresAt)}</p>
                <div className="mt-1 flex items-center gap-2">
                  <input readOnly value={link.url} className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-1 text-xs" onFocus={(event) => event.currentTarget.select()} />
                  <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(link.url)}>Copiar</Button>
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
