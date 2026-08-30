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

export function readCache<T>(key: string): T | null {
  if (memory.has(key)) return memory.get(key) as T;
  const raw = storage()?.getItem(PREFIX + key) ?? null;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as T;
    memory.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T): void {
  memory.set(key, value);
  try {
    storage()?.setItem(PREFIX + key, JSON.stringify(value));
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
