"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { locales } from "@/i18n/config";
import { setUserLocale } from "@/i18n/locale";
import type { Id, MemberRequest } from "./types";
import { BottomSheet } from "./bottom-sheet";
import { Segmented } from "./Segmented";
import { ThemeToggle } from "./ThemeToggle";
import { cx, NotificationBell, NotificationList } from "./ui";

/**
 * PT / EN as a `Segmented`, matching the theme switch above it. Writes the
 * locale cookie and refreshes the layout; an optimistic value keeps the pill
 * from snapping back while the refresh lands.
 */
export function LanguageSegmented({ className }: { className?: string }) {
  const t = useTranslations("language");
  const active = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<(typeof locales)[number] | null>(null);
  const value = optimistic ?? (active as (typeof locales)[number]);

  return (
    <Segmented
      className={className}
      ariaLabel={t("legend")}
      value={value}
      onChange={(next) => {
        if (pending || next === value) return;
        setOptimistic(next);
        startTransition(async () => {
          await setUserLocale(next);
          router.refresh();
          setOptimistic(null);
        });
      }}
      options={locales.map((locale) => ({ value: locale, label: t(locale) }))}
    />
  );
}

/**
 * Per-visitor preferences — theme and language — behind one "adjustments" icon.
 * No account needed: the choices are a cookie + localStorage, so it works on the
 * public pages (sign-in, templates, a shared results link) too.
 */
/**
 * Phone header: the bell and the sliders both open one bottom sheet holding the
 * member-request updates plus theme + language. Replaces two cramped top
 * dropdowns on small screens (they still render inline from `sm:` up).
 */
export function MobileHeaderMenu({
  notifications,
  onAcceptRequest,
  onDeclineRequest,
}: {
  notifications: MemberRequest[];
  onAcceptRequest: (id: Id) => Promise<void>;
  onDeclineRequest: (id: Id) => Promise<void>;
}) {
  const t = useTranslations("settings");
  const tNotify = useTranslations("notifications");
  const tTheme = useTranslations("theme");
  const tLang = useTranslations("language");
  const [open, setOpen] = useState(false);
  const count = (notifications ?? []).length;
  const trigger =
    "relative grid h-9 w-9 cursor-pointer place-items-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--wash)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25";

  return (
    <div className="flex items-center gap-0.5 sm:hidden">
      <button type="button" className={trigger} aria-label={count ? tNotify("labelCount", { count }) : tNotify("label")} onClick={() => setOpen(true)}>
        <NotificationBell count={count} />
      </button>
      <button type="button" className={trigger} aria-label={t("legend")} onClick={() => setOpen(true)}>
        <svg viewBox="0 0 16 16" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
          <path d="M2 4.5h12M2 11.5h12" />
          <circle cx="11" cy="4.5" r="2" fill="currentColor" stroke="none" />
          <circle cx="5" cy="11.5" r="2" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {open ? (
        <BottomSheet title={t("legend")} onClose={() => setOpen(false)}>
          <section className="mb-6">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">{tNotify("title")}</h3>
            <div className="overflow-hidden rounded-2xl border border-[var(--line)]">
              <NotificationList notifications={notifications} onAcceptRequest={onAcceptRequest} onDeclineRequest={onDeclineRequest} />
            </div>
          </section>
          <section className="mb-5">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">{tTheme("legend")}</h3>
            <ThemeToggle />
          </section>
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">{tLang("legend")}</h3>
            <LanguageSegmented />
          </section>
        </BottomSheet>
      ) : null}
    </div>
  );
}

export function SettingsMenu({ className }: { className?: string }) {
  const t = useTranslations("settings");
  const tTheme = useTranslations("theme");
  const tLang = useTranslations("language");
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

  const label = (text: string) => (
    <span className="text-[11px] font-semibold tracking-[0.06em] text-[var(--muted)]">{text}</span>
  );

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={t("legend")}
        aria-expanded={open}
        className={cx(
          "grid h-9 w-9 cursor-pointer place-items-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--wash)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25",
          open && "bg-[var(--wash)] text-[var(--ink)]",
          className,
        )}
      >
        <svg viewBox="0 0 16 16" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
          <path d="M2 4.5h12M2 11.5h12" />
          <circle cx="11" cy="4.5" r="2" fill="currentColor" stroke="none" />
          <circle cx="5" cy="11.5" r="2" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {open ? (
        <div
          className="absolute right-0 z-50 mt-2 w-[min(92vw,20rem)] space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 shadow-[var(--elevate-2)]"
          role="dialog"
          aria-label={t("legend")}
        >
          <div>
            {label(tTheme("legend"))}
            <ThemeToggle className="mt-2" />
          </div>
          <div>
            {label(tLang("legend"))}
            <LanguageSegmented className="mt-2" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
