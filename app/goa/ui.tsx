"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useGoaFormat } from "./format";
import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";
import type { ChallengeStatus, Id, MemberRequest, SubmissionMode, User } from "./types";
import {
  dateKeyInSaoPaulo,
  inclusiveDayCount,
  isChallengeScheduled,
  shiftDateKey,
} from "./utils";

export const cardClass =
  "rounded-[20px] border border-[var(--line)] bg-[var(--paper)] shadow-[var(--elevate-1)]";
export const inputClass =
  "mb-1 min-h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3.5 py-2.5 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--main)] focus:ring-4 focus:ring-[var(--main)]/15 disabled:cursor-not-allowed disabled:bg-[var(--canvas)]";
export const labelClass = "mb-1.5 block text-sm font-normal text-[var(--ink)]";
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
    secondary: "border-[var(--line)] bg-transparent text-[var(--ink)] hover:bg-[var(--hover)]",
    ghost: "border-transparent bg-transparent text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
    danger: "border-[var(--danger-line)] bg-transparent text-[var(--danger)] hover:bg-[var(--danger-soft)]",
  };
  return (
    <button
      className={cx(
        "cursor-pointer inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-light transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25 disabled:cursor-not-allowed disabled:opacity-55",
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

function CircleCheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="8" cy="8" r="6.3" />
      <path d="M5.4 8.2 7.2 10l3.4-3.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CircleExclamationIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="8" cy="8" r="6.3" />
      <path d="M8 4.6v4" strokeLinecap="round" />
      <circle cx="8" cy="11.1" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CircleMinusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="8" cy="8" r="6.3" />
      <path d="M5.2 8h5.6" strokeLinecap="round" />
    </svg>
  );
}

export function StatusMessage({
  error,
  success,
}: {
  error?: string | null;
  success?: string | null;
}) {
  const tc = useTranslations("common");
  const message = error ?? success ?? null;
  const [dismissed, setDismissed] = useState(false);
  const [lastMessage, setLastMessage] = useState(message);
  if (message !== lastMessage) {
    setLastMessage(message);
    setDismissed(false);
  }
  if (!message || dismissed) return null;
  return (
    <div
      className={cx(
        "flex items-start gap-2 rounded-xl border px-4 py-3 text-sm",
        error ? "border-[var(--danger-line)] bg-[var(--danger-soft)] text-[var(--danger-strong)]" : "border-[var(--ok-line)] bg-[var(--ok-soft)] text-[var(--ok)]",
      )}
      role={error ? "alert" : "status"}
      aria-live="polite"
    >
      {error ? <CircleExclamationIcon className="mt-0.5 h-4 w-4 flex-none" /> : <CircleCheckIcon className="mt-0.5 h-4 w-4 flex-none" />}
      <span className="flex-1">{message}</span>
      <button
        type="button"
        className="flex-none rounded-full opacity-60 transition hover:opacity-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25"
        onClick={() => setDismissed(true)}
        aria-label={tc("close")}
      >
        <CircleMinusIcon className="h-4 w-4" />
      </button>
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

export function LoadingView({ label }: { label?: string }) {
  const t = useTranslations("common");
  return (
    <div className="grid min-h-screen place-items-center px-6" role="status" aria-live="polite">
      <div className="text-center">
        <span className="mx-auto mb-4 block h-10 w-10 animate-spin rounded-full border-4 border-[var(--main-line)] border-t-[var(--main)]" aria-hidden="true" />
        <p className="text-sm font-medium text-[var(--muted)]">{label ?? t("loadingApp")}</p>
      </div>
    </div>
  );
}

export function Brand() {
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="Goa">
      <span className="grid h-9 w-9 -rotate-3 place-items-center rounded-[50%_50%_50%_16%] bg-[var(--ink)] text-lg font-black text-[var(--canvas)] border-1 border-[var(--paper)]" aria-hidden="true">
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
        <h1 className="text-3xl font-medium tracking-[-0.045em] sm:text-4xl">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

const DURATION_PRESETS: Array<{ key: "d30" | "d60" | "d90" | "m6" | "y1"; shift: { days?: number; months?: number } }> = [
  { key: "d30", shift: { days: 29 } },
  { key: "d60", shift: { days: 59 } },
  { key: "d90", shift: { days: 89 } },
  { key: "m6", shift: { months: 6, days: -1 } },
  { key: "y1", shift: { months: 12, days: -1 } },
];

/**
 * Início/término pair with duration shortcuts: pick "90 dias" (or type the day
 * count) and the end date is derived from the start — no calendar counting. The
 * start can sit in the past, so a challenge run before the app can be rebuilt.
 */
export function SchedulePeriodFields({
  startsOn,
  endsOn,
  onStartsOn,
  onEndsOn,
  disabled = false,
}: {
  startsOn: string;
  endsOn: string;
  onStartsOn: (value: string) => void;
  onEndsOn: (value: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("schedule");
  const f = useGoaFormat();
  const today = dateKeyInSaoPaulo(new Date());
  const anchor = startsOn || today;
  const duration = inclusiveDayCount(startsOn, endsOn);

  function applyShift(shift: { days?: number; months?: number }) {
    if (!startsOn) onStartsOn(anchor);
    onEndsOn(shiftDateKey(anchor, shift));
  }

  return (
    <>
      <label>
        <span className={labelClass}>{t("start")}</span>
        <input className={inputClass} type="date" value={startsOn} onChange={(event) => onStartsOn(event.target.value)} required disabled={disabled} />
      </label>
      <label>
        <span className={labelClass}>{t("end")}</span>
        <input className={inputClass} type="date" min={startsOn || undefined} value={endsOn} onChange={(event) => onEndsOn(event.target.value)} required disabled={disabled} />
      </label>
      <div className="sm:col-span-2">
        <span className={labelClass}>{t("duration")}</span>
        <p className="text-xs leading-5 text-[var(--muted)]">{t("durationHint", { today: startsOn ? "" : t("durationHintToday") })}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {DURATION_PRESETS.map((preset) => {
            const active = Boolean(startsOn && endsOn) && shiftDateKey(anchor, preset.shift) === endsOn;
            return (
              <button
                key={preset.key}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => applyShift(preset.shift)}
                className={cx(
                  "min-h-9 rounded-full border px-3 text-xs transition disabled:cursor-not-allowed disabled:opacity-60",
                  active ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--main-line)]",
                )}
              >
                {t(`preset.${preset.key}`)}
              </button>
            );
          })}
          <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <input
              type="number"
              min={1}
              max={3660}
              inputMode="numeric"
              disabled={disabled}
              value={duration ?? ""}
              onChange={(event) => {
                const days = Number(event.target.value);
                if (Number.isInteger(days) && days >= 1 && days <= 3660) applyShift({ days: days - 1 });
              }}
              className="w-16 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-1.5 text-center text-sm text-[var(--ink)] outline-none focus:border-[var(--main)] disabled:cursor-not-allowed disabled:bg-[var(--canvas)]"
              aria-label={t("durationDaysAria")}
            />
            {t("days")}
          </label>
        </div>
        {duration ? <p className="mt-2 text-xs text-[var(--muted)]">{t("span", { count: duration, range: f.dateRange(startsOn, endsOn) })}</p> : null}
      </div>
    </>
  );
}

export function AppHeader({
  user,
  notifications,
  onHome,
  onAccount,
  onOpenPersonalSpace,
  onOpenTemplates,
  onOpenAbout,
  onLogout,
  onAcceptRequest,
  onDeclineRequest,
}: {
  user: User;
  notifications: MemberRequest[];
  onHome: () => void;
  onAccount: () => void;
  onOpenPersonalSpace: () => void;
  onOpenTemplates: () => void;
  onOpenAbout: () => void;
  onLogout: () => Promise<void>;
  onAcceptRequest: (id: Id) => Promise<void>;
  onDeclineRequest: (id: Id) => Promise<void>;
}) {
  const t = useTranslations("nav");
  const [busy, setBusy] = useState(false);
  const navLink = "min-h-11 cursor-pointer rounded-xl px-2 text-xs text-[var(--muted)] hover:bg-[var(--wash)] hover:text-[var(--ink)] disabled:cursor-not-allowed sm:px-3";
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--edge)] bg-[var(--canvas)]/92 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:h-[76px] sm:px-6">
        <button className="cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25" type="button" onClick={onHome}><Brand /></button>
        <div className="flex min-w-0 items-center gap-0.5 sm:gap-2">
          <button className={cx(navLink, "hidden items-center sm:inline-flex")} type="button" onClick={onHome}>{t("home")}</button>
          <button className={cx(navLink, "hidden items-center sm:inline-flex")} type="button" onClick={onOpenPersonalSpace}>{t("personalSpace")}</button>
          <button className={cx(navLink, "hidden items-center sm:inline-flex")} type="button" onClick={onOpenTemplates}>{t("templates")}</button>
          <button className={cx(navLink, "hidden items-center sm:inline-flex")} type="button" onClick={onOpenAbout}>{t("about")}</button>
          {user.platformAdmin ? (
            <Link className={cx(navLink, "hidden items-center sm:inline-flex")} href="/admin">{t("admin")}</Link>
          ) : null}
          <button
            className="flex shrink-0 cursor-pointer items-center gap-2.5 rounded-xl p-1 pr-1 text-left hover:bg-[var(--wash)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25 sm:pr-2"
            type="button"
            onClick={onAccount}
            aria-label={t("account")}
          >
            <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--paper)] bg-[var(--main-line)] text-xs font-black" aria-hidden="true">
              {user.name.split(/\s+/).slice(0, 1).map((part) => part[0]).join("")}
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
          <LanguageToggle />
          <button
            className={cx(navLink, "hidden shrink-0 disabled:opacity-50 sm:inline-flex sm:items-center")}
            type="button"
            disabled={busy}
            onClick={async () => { setBusy(true); try { await onLogout(); } finally { setBusy(false); } }}
          >
            {busy ? t("signingOut") : t("signOut")}
          </button>
          <HeaderOverflowMenu isPlatformAdmin={Boolean(user.platformAdmin)} busy={busy} onHome={onHome} onOpenPersonalSpace={onOpenPersonalSpace} onOpenTemplates={onOpenTemplates} onOpenAbout={onOpenAbout} onLogout={async () => { setBusy(true); try { await onLogout(); } finally { setBusy(false); } }} />
        </div>
      </div>
    </header>
  );
}

/**
 * Phone-only overflow for the header's secondary links + sign out. On `sm:` and
 * up those live inline and this collapses away, so the small-screen header stays
 * down to the account, notifications and settings glyphs.
 */
function HeaderOverflowMenu({
  isPlatformAdmin,
  busy,
  onHome,
  onOpenPersonalSpace,
  onOpenTemplates,
  onOpenAbout,
  onLogout,
}: {
  isPlatformAdmin: boolean;
  busy: boolean;
  onHome: () => void;
  onOpenPersonalSpace: () => void;
  onOpenTemplates: () => void;
  onOpenAbout: () => void;
  onLogout: () => Promise<void>;
}) {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const itemClass = "block min-h-11 rounded-xl px-3 py-2.5 text-sm text-[var(--ink)] hover:bg-[var(--wash)]";
  return (
    <div className="relative sm:hidden" ref={containerRef}>
      <button
        className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-xl text-[var(--muted)] hover:bg-[var(--wash)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={t("menu")}
        aria-expanded={open}
      >
        <svg viewBox="0 0 16 16" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden="true">
          <circle cx="8" cy="3" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="8" cy="13" r="1.5" />
        </svg>
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-52 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-1.5 shadow-[var(--elevate-2)]" role="dialog" aria-label={t("menu")}>
          <button className={cx(itemClass, "w-full text-left")} type="button" onClick={() => { onHome(); setOpen(false); }}>{t("home")}</button>
          <button className={cx(itemClass, "w-full text-left")} type="button" onClick={() => { onOpenPersonalSpace(); setOpen(false); }}>{t("personalSpace")}</button>
          <button className={cx(itemClass, "w-full text-left")} type="button" onClick={() => { onOpenTemplates(); setOpen(false); }}>{t("templates")}</button>
          <button className={cx(itemClass, "w-full text-left")} type="button" onClick={() => { onOpenAbout(); setOpen(false); }}>{t("about")}</button>
          {isPlatformAdmin ? <Link className={itemClass} href="/admin" onClick={() => setOpen(false)}>{t("admin")}</Link> : null}
          <div className="my-1 border-t border-[var(--line)]" />
          <button
            className={cx(itemClass, "w-full text-left disabled:opacity-50")}
            type="button"
            disabled={busy}
            onClick={async () => { await onLogout(); setOpen(false); }}
          >
            {busy ? t("signingOut") : t("signOut")}
          </button>
        </div>
      ) : null}
    </div>
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
  const t = useTranslations("notifications");
  const tTheme = useTranslations("theme");
  const f = useGoaFormat();
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<Id | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inbox = notifications ?? [];
  const count = inbox.length;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  async function respond(id: Id, action: "accept" | "decline") {
    setPendingId(id);
    setError(null);
    try {
      await (action === "accept" ? onAcceptRequest(id) : onDeclineRequest(id));
    } catch {
      setError(t("error"));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        className="relative grid h-9 w-9 cursor-pointer place-items-center rounded-xl text-[var(--muted)] hover:bg-[var(--wash)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={count ? t("labelCount", { count }) : t("label")}
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
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,22rem)] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper)] shadow-[var(--elevate-2)]" role="dialog" aria-label={t("title")}>
          <div className="border-b border-[var(--line)] px-4 py-3">
            <strong className="text-sm">{tTheme("legend")}</strong>
            <div className="mt-2"><ThemeToggle /></div>
          </div>
          <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
            <strong className="text-sm">{t("title")}</strong>
            {count ? <span className="text-xs text-[var(--muted)]">{t("pending", { count })}</span> : null}
          </div>
          {error ? <p className="border-b border-[var(--line)] bg-[var(--danger-soft)] px-4 py-2 text-xs text-[var(--danger)]">{error}</p> : null}
          {count ? (
            <ul className="max-h-[70vh] divide-y divide-[var(--line)] overflow-y-auto">
              {inbox.map((request) => (
                <li className="px-4 py-3" key={request.id}>
                  <p className="text-sm leading-5">
                    {t.rich("invited", {
                      invitedBy: request.invitedBy ?? t("someone"),
                      groupName: request.groupName,
                      b: (chunks) => <strong>{chunks}</strong>,
                    })}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{f.dateTime(request.createdAt)}</p>
                  <div className="mt-2 flex gap-2">
                    <Button className="min-h-9 px-3 py-1 text-xs" disabled={pendingId === request.id} onClick={() => void respond(request.id, "accept")}>
                      {pendingId === request.id ? "…" : t("accept")}
                    </Button>
                    <Button className="min-h-9 px-3 py-1 text-xs" variant="ghost" disabled={pendingId === request.id} onClick={() => void respond(request.id, "decline")}>
                      {t("decline")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">{t("empty")}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

const CHALLENGE_STATUS_TONE: Record<
  "draft" | "scheduled" | "active" | "closed",
  { dot: string; border: string; solid: string }
> = {
  draft: { dot: "bg-[var(--warn-line)]", border: "border-[var(--warn-line)]", solid: "bg-[var(--warn-line)]" },
  scheduled: { dot: "bg-[var(--main-line)]", border: "border-[var(--main-line)]", solid: "bg-[var(--main-line)]" },
  active: { dot: "bg-[var(--ok-line)]", border: "border-[var(--ok-line)]", solid: "bg-[var(--ok-line)]" },
  closed: { dot: "bg-[var(--line)]", border: "border-[var(--line)]", solid: "bg-[var(--line)]" },
};

export function challengeStatusTone(status: ChallengeStatus, startsOn?: string | null, submissionMode?: SubmissionMode) {
  return CHALLENGE_STATUS_TONE[isChallengeScheduled(status, startsOn, submissionMode) ? "scheduled" : status];
}

export function ChallengeStatusBadge({ status, startsOn, submissionMode }: { status: ChallengeStatus; startsOn?: string | null; submissionMode?: SubmissionMode }) {
  const t = useTranslations("challengeStatus");
  const f = useGoaFormat();
  const tone = challengeStatusTone(status, startsOn, submissionMode);
  const label = f.challengeStatusLabel(status, startsOn, submissionMode);
  return (
    <span
      className={cx("inline-block h-2.5 w-2.5 flex-none rounded-full ring-1 ring-inset ring-[var(--edge)]", tone.dot)}
      role="img"
      aria-label={t("srLabel", { label })}
      title={label}
    />
  );
}
