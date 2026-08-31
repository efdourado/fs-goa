"use client";

import { useTranslations } from "next-intl";
import { useEffect, useSyncExternalStore } from "react";

import { cx } from "./ui";

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "goa-theme";
const PREFERENCES: ThemePreference[] = ["system", "light", "dark"];

/** Turns a stored preference into the concrete theme painted on `<html>`. */
export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "system") {
    return typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return preference;
}

const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function readPreference(): ThemePreference {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function applyPreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Private mode or blocked storage — the cookie below still carries the choice.
  }
  document.cookie = `${STORAGE_KEY}=${preference};path=/;max-age=31536000;samesite=lax`;
  document.documentElement.dataset.theme = resolveTheme(preference);
  listeners.forEach((listener) => listener());
}

const ICONS: Record<ThemePreference, string> = {
  system: "M2 3.5h12v7.5H2zM6 13.5h4M8 11v2.5",
  light: "M8 3v1.5M8 11.5V13M3 8H1.5M14.5 8H13M4.4 4.4 3.4 3.4M12.6 12.6l-1-1M11.6 4.4l1-1M3.4 12.6l1-1",
  dark: "M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z",
};

/**
 * System / Light / Dark segmented control. The preference lives in
 * `localStorage` (source of truth) plus a cookie so the server can paint the
 * right theme on the first response; the no-flash script in the root layout
 * reconciles both before paint.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("theme");
  const preference = useSyncExternalStore<ThemePreference>(subscribe, readPreference, () => "system");

  useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      document.documentElement.dataset.theme = media.matches ? "dark" : "light";
    };
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [preference]);

  return (
    <div
      className={cx(
        "inline-flex items-center gap-0.5 rounded-full border border-[var(--line)] bg-[var(--paper)] p-0.5",
        className,
      )}
      role="group"
      aria-label={t("legend")}
    >
      {PREFERENCES.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => applyPreference(value)}
          aria-pressed={preference === value}
          title={t(value)}
          className={cx(
            "grid h-7 w-7 cursor-pointer place-items-center rounded-full transition",
            preference === value
              ? "bg-[var(--main-soft)] text-[var(--main-strong)]"
              : "text-[var(--muted)] hover:text-[var(--ink)]",
          )}
        >
          <svg viewBox="0 0 16 16" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={ICONS[value]} />
          </svg>
          <span className="sr-only">{t(value)}</span>
        </button>
      ))}
    </div>
  );
}
