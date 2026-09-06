/**
 * Per-tab stale-while-revalidate cache for the data the app re-reads on every
 * navigation (the bootstrap payload and each challenge's detail). Screens render
 * the cached copy immediately and the caller refetches in the background, so the
 * database round-trip stops being on the critical path.
 *
 * Backed by sessionStorage: it survives in-app navigation and reloads, is scoped
 * to the tab, and clears when the tab closes. An in-memory mirror keeps reads
 * cheap and keeps working when storage is unavailable (private mode, quota).
 */
const PREFIX = "goa:cache:";
const memory = new Map<string, unknown>();

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Painting private data from a stale cache risks flashing the previous user's
 *  content on a shared device — only trust an entry written in the last minute;
 *  older ones still get replaced by the live fetch, just without the instant paint. */
const MAX_AGE_MS = 60_000;

export function readCache<T>(key: string): T | null {
  const cached = memory.has(key) ? (memory.get(key) as { at: number; value: T }) : parseStored<T>(key);
  if (!cached) return null;
  if (Date.now() - cached.at > MAX_AGE_MS) return null;
  return cached.value;
}

function parseStored<T>(key: string): { at: number; value: T } | null {
  const raw = storage()?.getItem(PREFIX + key) ?? null;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { at: number; value: T };
    if (typeof parsed?.at !== "number") return null;
    memory.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T): void {
  const entry = { at: Date.now(), value };
  memory.set(key, entry);
  try {
    storage()?.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // Quota or a disabled store: the in-memory mirror still serves this tab.
  }
}

export function clearCache(): void {
  memory.clear();
  const store = storage();
  if (!store) return;
  try {
    for (let index = store.length - 1; index >= 0; index -= 1) {
      const key = store.key(index);
      if (key?.startsWith(PREFIX)) store.removeItem(key);
    }
  } catch {
    // Nothing else to do; a failed clear only leaves harmless stale entries.
  }
}

export const CACHE_KEYS = {
  bootstrap: "bootstrap",
  challenge: (challengeId: string) => `challenge:${challengeId}`,
} as const;
