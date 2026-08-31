"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";
import { cx } from "./ui";

/**
 * One header affordance for the two per-visitor preferences (theme + language),
 * so neither crowds the top bar. Open/close mirrors `NotificationsMenu`.
 */
export function SettingsMenu({ align = "right" }: { align?: "left" | "right" }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={closeRef}
        className="grid h-9 w-9 cursor-pointer place-items-center rounded-xl text-[var(--muted)] hover:bg-[var(--wash)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={t("settings.legend")}
        aria-expanded={open}
      >
        <svg viewBox="0 0 16 16" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
          <path d="M2 4.5h8M13 4.5h1M2 11.5h1M6 11.5h8" />
          <circle cx="11.5" cy="4.5" r="1.7" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="11.5" r="1.7" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {open ? (
        <>
          <button type="button" aria-hidden="true" tabIndex={-1} className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div
            className={cx(
              "absolute z-50 mt-2 w-[min(90vw,17rem)] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 shadow-[var(--elevate-2)]",
              align === "right" ? "right-0" : "left-0",
            )}
            role="dialog"
            aria-label={t("settings.legend")}
          >
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("theme.legend")}</p>
            <ThemeToggle />
            <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("language.legend")}</p>
            <LanguageToggle />
          </div>
        </>
      ) : null}
    </div>
  );
}
