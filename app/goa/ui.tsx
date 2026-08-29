"use client";

import { type ReactNode, useState } from "react";

import type { ChallengeStatus, User } from "./types";

export const cardClass =
  "rounded-[20px] border border-[var(--line)] bg-[var(--paper)] shadow-[0_1px_2px_rgba(32,36,31,0.04)]";
export const inputClass =
  "mb-1 min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3.5 py-2.5 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--violet)] focus:ring-4 focus:ring-[rgba(103,88,216,0.12)] disabled:cursor-not-allowed disabled:bg-[var(--canvas)]";
export const labelClass = "mb-1.5 block text-sm font-semibold text-[var(--ink)]";

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
        error ? "border-red-200 bg-red-50 text-red-900" : "border-emerald-200 bg-emerald-50 text-emerald-900",
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

export function LoadingView({ label = "Carregando o Goa…" }: { label?: string }) {
  return (
    <div className="grid min-h-screen place-items-center px-6" role="status" aria-live="polite">
      <div className="text-center">
        <span className="mx-auto mb-4 block h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-[var(--violet)]" aria-hidden="true" />
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
        <h1 className="text-3xl font-bold tracking-[-0.045em] sm:text-4xl">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function AppHeader({
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

export function ChallengeStatusBadge({ status }: { status: ChallengeStatus }) {
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
