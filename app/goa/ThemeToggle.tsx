"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

import { Segmented } from "./Segmented";

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

export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("theme");
  const preference = useSyncExternalStore<ThemePreference>(subscribe, readPreference, () => "system");

  return (
    <Segmented
      className={className}
      ariaLabel={t("legend")}
      value={preference}
      onChange={applyPreference}
      options={PREFERENCES.map((value) => ({ value, label: t(value) }))}
    />
  );
}
