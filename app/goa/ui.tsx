"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";

import type { ChallengeStatus, Id, MemberRequest, User } from "./types";
import { formatDateTime, isChallengeScheduled } from "./utils";

export const cardClass =
  "rounded-[20px] border border-[var(--line)] bg-[var(--paper)] shadow-[0_1px_2px_rgba(32,36,31,0.04)]";
export const inputClass =
  "mb-1 min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3.5 py-2.5 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--main)] focus:ring-4 focus:ring-[var(--main)]/15 disabled:cursor-not-allowed disabled:bg-[var(--canvas)]";
export const labelClass = "mb-1.5 block text-sm font-medium text-[var(--ink)]";
export const linkClass =
  "px-4 py-2 border-l-1 rounded-xl border-[var(--muted)] underline-offset-4 hover:opacity-90 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";
/** The "← Voltar" links that sit at the top of most screens. */
export const backLinkClass =
  "min-h-11 cursor-pointer text-sm font-light text-[var(--muted)] hover:text-[var(--ink)]";

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function Button({
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
    primary: "border-transparent bg-[var(--main)] text-white hover:opacity-90",
    secondary: "border-[var(--line)] bg-transparent text-[var(--ink)] hover:bg-black/[0.04]",
    ghost: "border-transparent bg-transparent text-[var(--muted)] hover:bg-black/[0.04] hover:text-[var(--ink)]",
    danger: "border-[var(--danger-line)] bg-transparent text-[var(--danger)] hover:bg-[var(--danger-soft)]",
  };
  return (
    <button
      className={cx(
        "cursor-pointer inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-light transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25 disabled:cursor-not-allowed disabled:opacity-55",
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

export function StatusMessage({
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
        error ? "border-[var(--danger-line)] bg-[var(--danger-soft)] text-[var(--danger-strong)]" : "border-[var(--ok-line)] bg-[var(--ok-soft)] text-[var(--ok)]",
      )}
      role={error ? "alert" : "status"}
      aria-live="polite"
    >
      {error ?? success}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--wash)]/70 px-5 py-10 text-center">
      <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[var(--main-soft)] text-xl text-[var(--main-strong)]" aria-hidden="true">
        ᴖ̈
      </span>
      <h3 className="text-lg font-light tracking-[-0.02em]">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function LoadingView({ label = "Carregando o Goa…" }: { label?: string }) {
  return (
    <div className="grid min-h-screen place-items-center px-6" role="status" aria-live="polite">
      <div className="text-center">
        <span className="mx-auto mb-4 block h-10 w-10 animate-spin rounded-full border-4 border-[var(--main-line)] border-t-[var(--main)]" aria-hidden="true" />
        <p className="text-sm font-semibold text-[var(--muted)]">{label}</p>
      </div>
    </div>
  );
}

export function Brand() {
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="Goa">
      <span className="grid h-9 w-9 -rotate-3 place-items-center rounded-[50%_50%_50%_16%] bg-[var(--ink)] text-lg font-black text-[var(--canvas)] border-1 border-white" aria-hidden="true">
        g
      </span>
      <strong className="text-xl tracking-[-0.06em]">goa</strong>
    </span>
  );
}

export function PageHeading({
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
        <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function AppHeader({
  user,
  notifications,
  onHome,
  onAccount,
  onLogout,
  onAcceptRequest,
  onDeclineRequest,
}: {
  user: User;
  notifications: MemberRequest[];
  onHome: () => void;
  onAccount: () => void;
  onLogout: () => Promise<void>;
  onAcceptRequest: (id: Id) => Promise<void>;
  onDeclineRequest: (id: Id) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const navLink = "min-h-11 cursor-pointer rounded-xl px-2 text-xs text-[var(--muted)] hover:bg-[var(--wash)] hover:text-[var(--ink)] disabled:cursor-not-allowed sm:px-3";
  return (
    <header className="sticky top-0 z-30 border-b border-black/10 bg-[var(--canvas)]/92 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:h-[76px] sm:px-6">
        <button className="cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25" type="button" onClick={onHome}><Brand /></button>
        <div className="flex items-center gap-1 sm:gap-2">
          <Link className={cx(navLink, "inline-flex items-center")} href="/modelos">Modelos</Link>
          {user.platformAdmin ? (
            <Link className={cx(navLink, "inline-flex items-center")} href="/admin">Gestão</Link>
          ) : null}
          <button
            className="flex cursor-pointer items-center gap-2.5 rounded-xl p-1 pr-2 text-left hover:bg-[var(--wash)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25"
            type="button"
            onClick={onAccount}
            aria-label="Sua conta"
          >
            <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-white bg-[var(--main-line)] text-xs font-black" aria-hidden="true">
              {user.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}
            </span>
            <span className="hidden leading-tight sm:block">
              <strong className="block text-sm">{user.name}</strong>
              <span className="block text-xs text-[var(--muted)]">@{user.username}</span>
            </span>
          </button>
          <NotificationsMenu
            notifications={notifications}
            onAcceptRequest={onAcceptRequest}
            onDeclineRequest={onDeclineRequest}
          />
          <button
            className={cx(navLink, "disabled:opacity-50")}
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

function NotificationsMenu({
  notifications,
  onAcceptRequest,
  onDeclineRequest,
}: {
  notifications: MemberRequest[];
  onAcceptRequest: (id: Id) => Promise<void>;
  onDeclineRequest: (id: Id) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<Id | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inbox = notifications ?? [];
  const count = inbox.length;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function respond(id: Id, action: "accept" | "decline") {
    setPendingId(id);
    setError(null);
    try {
      await (action === "accept" ? onAcceptRequest(id) : onDeclineRequest(id));
    } catch {
      setError("Não foi possível concluir. Tente de novo.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="relative">
      <button
        className="relative grid h-9 w-9 cursor-pointer place-items-center rounded-xl text-[var(--muted)] hover:bg-[var(--wash)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={count ? `Novidades (${count})` : "Novidades"}
        aria-expanded={open}
      >
        <svg viewBox="0 0 16 16" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M8 2a3.6 3.6 0 0 0-3.6 3.6c0 2.6-1 4-1.6 4.65h10.4C12.6 9.6 11.6 8.2 11.6 5.6A3.6 3.6 0 0 0 8 2Z" strokeLinejoin="round" />
          <path d="M6.4 12.25a1.6 1.6 0 0 0 3.2 0" strokeLinecap="round" />
        </svg>
        {count ? (
          <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--main)] px-1 text-[10px] font-black leading-none text-white">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>
      {open ? (
        <>
          <button type="button" aria-hidden="true" tabIndex={-1} className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-[min(92vw,22rem)] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper)] shadow-[0_12px_40px_rgba(32,36,31,0.16)]" role="dialog" aria-label="Novidades">
            <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
              <strong className="text-sm">Novidades</strong>
              {count ? <span className="text-xs text-[var(--muted)]">{count} pendente{count === 1 ? "" : "s"}</span> : null}
            </div>
            {error ? <p className="border-b border-[var(--line)] bg-[var(--danger-soft)] px-4 py-2 text-xs text-[var(--danger)]">{error}</p> : null}
            {count ? (
              <ul className="max-h-[70vh] divide-y divide-[var(--line)] overflow-y-auto">
                {inbox.map((request) => (
                  <li className="px-4 py-3" key={request.id}>
                    <p className="text-sm leading-5">
                      <strong>{request.invitedBy ?? "Alguém"}</strong> convidou você para o grupo <strong>{request.groupName}</strong>.
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">{formatDateTime(request.createdAt)}</p>
                    <div className="mt-2 flex gap-2">
                      <Button className="min-h-9 px-3 py-1 text-xs" disabled={pendingId === request.id} onClick={() => void respond(request.id, "accept")}>
                        {pendingId === request.id ? "…" : "Aceitar"}
                      </Button>
                      <Button className="min-h-9 px-3 py-1 text-xs" variant="ghost" disabled={pendingId === request.id} onClick={() => void respond(request.id, "decline")}>
                        Recusar
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">Nenhuma novidade.</p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

const CHALLENGE_STATUS_META: Record<
  "draft" | "scheduled" | "active" | "closed",
  { label: string; dot: string; border: string; solid: string }
> = {
  draft: { label: "Rascunho", dot: "bg-[var(--warn-line)]", border: "border-[var(--warn-line)]", solid: "bg-[var(--warn-line)]" },
  scheduled: { label: "Agendado", dot: "bg-[var(--main-line)]", border: "border-[var(--main-line)]", solid: "bg-[var(--main-line)]" },
  active: { label: "Ativo", dot: "bg-[var(--ok-line)]", border: "border-[var(--ok-line)]", solid: "bg-[var(--ok-line)]" },
  closed: { label: "Encerrado", dot: "bg-[var(--line)]", border: "border-[var(--line)]", solid: "bg-[var(--line)]" },
};

export function challengeStatusTone(status: ChallengeStatus, startsOn?: string | null) {
  return CHALLENGE_STATUS_META[isChallengeScheduled(status, startsOn) ? "scheduled" : status];
}

export function ChallengeStatusBadge({ status, startsOn }: { status: ChallengeStatus; startsOn?: string | null }) {
  const meta = challengeStatusTone(status, startsOn);
  return (
    <span
      className={cx("inline-block h-2.5 w-2.5 flex-none rounded-full ring-1 ring-inset ring-black/10", meta.dot)}
      role="img"
      aria-label={`Situação: ${meta.label}`}
      title={meta.label}
    />
  );
}
