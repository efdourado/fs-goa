"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

import { cx } from "./ui";

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "goa-theme";
const PREFERENCES: ThemePreference[] = ["system", "light", "dark"];

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

/**
 * Persists the choice and reflects it on `<html>`. "system" clears the attribute
 * so the CSS `prefers-color-scheme` block takes over; an explicit choice sets it.
 */
function applyPreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Private mode or blocked storage — the cookie below still carries the choice.
  }
  document.cookie = `${STORAGE_KEY}=${preference};path=/;max-age=31536000;samesite=lax`;
  if (preference === "light" || preference === "dark") {
    document.documentElement.setAttribute("data-theme", preference);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  listeners.forEach((listener) => listener());
}

const ICONS: Record<ThemePreference, string> = {
  system: "M2.5 3.5h11v7h-11zM6 13h4M8 10.5V13",
  light: "M8 2.6v1.6M8 11.8v1.6M2.6 8h1.6M11.8 8h1.6M4.2 4.2l1.1 1.1M10.7 10.7l1.1 1.1M11.8 4.2l-1.1 1.1M5.3 10.7l-1.1 1.1",
  dark: "M13 9.3A5.3 5.3 0 0 1 6.7 3 5.3 5.3 0 1 0 13 9.3Z",
};

/** iOS-style segmented control on a subtle track. System / Light / Dark. */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("theme");
  const preference = useSyncExternalStore<ThemePreference>(subscribe, readPreference, () => "system");

  return (
    <div
      className={cx("inline-flex gap-0.5 rounded-lg bg-[var(--wash)] p-0.5", className)}
      role="group"
      aria-label={t("legend")}
    >
      {PREFERENCES.map((value) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => applyPreference(value)}
            aria-pressed={active}
            title={t(value)}
            className={cx(
              "grid h-7 w-8 cursor-pointer place-items-center rounded-md transition",
              active
                ? "bg-[var(--paper)] text-[var(--ink)] shadow-[var(--elevate-1)]"
                : "text-[var(--muted)] hover:text-[var(--ink)]",
            )}
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill={value === "dark" ? "currentColor" : "none"} stroke="currentColor" strokeWidth={value === "dark" ? 0 : 1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={ICONS[value]} />
              {value === "light" ? <circle cx="8" cy="8" r="2.6" /> : null}
            </svg>
            <span className="sr-only">{t(value)}</span>
          </button>
        );
      })}
    </div>
  );
}
