"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

import { Toggle } from "./ui";

/**
 * One per-device switch for Home, kept next to theme and language: "Lock app". On, Home's View button and
 * Reorder go away — the arrangement and the challenge order stay as they are (pin and colour still work).
 * Off by default. Stored like the theme — localStorage, read through an external store so every open screen
 * follows a change at once.
 */
const STORAGE_KEY = "goa-home-lock";

const listeners = new Set<() => void>();
let fallback = false;

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function read(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return fallback;
  }
}

function write(locked: boolean) {
  fallback = locked;
  try {
    window.localStorage.setItem(STORAGE_KEY, locked ? "1" : "0");
  } catch {
    // Blocked storage — the choice lasts for this visit only.
  }
  listeners.forEach((listener) => listener());
}

export function useAppLocked(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

/** The switch, for the header's preferences menu. */
export function LockAppToggle() {
  const t = useTranslations("settings");
  const locked = useAppLocked();
  return (
    <label className="flex min-h-10 cursor-pointer items-center justify-between gap-3 text-sm">
      <span>{t("lockApp")}</span>
      <Toggle checked={locked} onChange={write} />
    </label>
  );
}
