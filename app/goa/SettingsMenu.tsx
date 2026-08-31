"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";
import { cx } from "./ui";

/**
 * One quiet header affordance for the two per-visitor preferences (theme +
 * language). Open/close mirrors `NotificationsMenu`.
 */
export function SettingsMenu({ align = "right" }: { align?: "left" | "right" }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

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
        className="grid h-9 w-9 cursor-pointer place-items-center rounded-xl text-[var(--muted)] hover:bg-[var(--wash)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={t("settings.legend")}
        aria-expanded={open}
      >
        <svg viewBox="0 0 16 16" className="h-[17px] w-[17px]" aria-hidden="true">
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 2a6 6 0 0 0 0 12Z" fill="currentColor" />
        </svg>
      </button>
      {open ? (
        <>
          <button type="button" aria-hidden="true" tabIndex={-1} className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div
            className={cx(
              "absolute z-50 mt-2 w-60 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 shadow-[var(--elevate-2)]",
              align === "right" ? "right-0" : "left-0",
            )}
            role="dialog"
            aria-label={t("settings.legend")}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--muted)]">{t("theme.legend")}</span>
              <ThemeToggle />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--muted)]">{t("language.legend")}</span>
              <LanguageToggle />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
