"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";

import type { ChallengeStatus, User } from "./types";
import { isChallengeScheduled } from "./utils";

export const cardClass =
  "rounded-[20px] border border-[var(--line)] bg-[var(--paper)] shadow-[0_1px_2px_rgba(32,36,31,0.04)]";
export const inputClass =
  "mb-1 min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3.5 py-2.5 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--main)] focus:ring-4 focus:ring-[var(--main)]/15 disabled:cursor-not-allowed disabled:bg-[var(--canvas)]";
export const labelClass = "mb-1.5 block text-sm font-semibold text-[var(--ink)]";
export const linkClass =
  "px-4 py-2 border-l-1 rounded-xl border-[var(--muted)] underline-offset-4 hover:opacity-90 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";

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
        ᥫ᭡
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
  onHome,
  onAccount,
  onLogout,
}: {
  user: User;
  onHome: () => void;
  onAccount: () => void;
  onLogout: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const navLink = "min-h-11 cursor-pointer rounded-xl px-2 text-xs text-[var(--muted)] hover:bg-[var(--wash)] hover:text-[var(--ink)] disabled:cursor-not-allowed sm:px-3";
  return (
    <header className="sticky top-0 z-30 border-b border-black/10 bg-[var(--canvas)]/92 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:h-[76px] sm:px-6">
        <button className="cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25" type="button" onClick={onHome}><Brand /></button>
        <div className="flex items-center gap-1 sm:gap-2">
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
