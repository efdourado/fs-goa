"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

import { Toggle } from "./ui";

/**
 * Two per-device switches for Home, kept next to theme and language: whether the View button shows (off = the
 * arrangement is locked as it is) and whether the challenge order is locked (no Reorder, no move up/down).
 * Both start off. Stored like the theme — localStorage, read through an external store so every open screen
 * follows a change at once.
 */
export interface HomePrefs {
  showView: boolean;
  lockOrder: boolean;
}

const STORAGE_KEY = "goa-home-prefs";
const DEFAULTS: HomePrefs = { showView: false, lockOrder: false };

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cached: HomePrefs = DEFAULTS;

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function read(): HomePrefs {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return cached;
  }
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<HomePrefs>) : {};
    cached = { showView: parsed.showView === true, lockOrder: parsed.lockOrder === true };
  } catch {
    cached = DEFAULTS;
  }
  return cached;
}

function write(next: HomePrefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Blocked storage — keep the choice for this visit only.
    cachedRaw = JSON.stringify(next);
    cached = next;
  }
  listeners.forEach((listener) => listener());
}

export function useHomePrefs(): HomePrefs {
  return useSyncExternalStore(subscribe, read, () => DEFAULTS);
}

/** The two switches, for the header's preferences menu. */
export function HomePrefsToggles() {
  const t = useTranslations("settings");
  const prefs = useHomePrefs();
  const row = (key: keyof HomePrefs, label: string) => (
    <label className="flex min-h-10 cursor-pointer items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <Toggle checked={prefs[key]} onChange={(value) => write({ ...prefs, [key]: value })} />
    </label>
  );
  return (
    <div className="space-y-1">
      {row("showView", t("showView"))}
      {row("lockOrder", t("lockOrder"))}
    </div>
  );
}
