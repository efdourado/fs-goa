import assert from "node:assert/strict";
import test from "node:test";

import { CACHE_KEYS, clearCache, readCache, writeCache } from "../app/goa/cache";

function fakeSessionStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, String(value)); },
    removeItem: (key: string) => { map.delete(key); },
    clear: () => { map.clear(); },
  } as Storage;
}

function withWindow(storage: Storage | (() => never)): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    get() { return { get sessionStorage() { return typeof storage === "function" ? storage() : storage; } }; },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  };
}

test("guarda e devolve valores por chave, e limpa tudo", () => {
  const restore = withWindow(fakeSessionStorage());
  try {
    clearCache();
    assert.equal(readCache(CACHE_KEYS.bootstrap), null);

    writeCache(CACHE_KEYS.bootstrap, { user: { id: "u1" } });
    writeCache(CACHE_KEYS.challenge("c1"), { challenge: { id: "c1" }, entries: [] });
    assert.deepEqual(readCache(CACHE_KEYS.bootstrap), { user: { id: "u1" } });
    assert.deepEqual(readCache(CACHE_KEYS.challenge("c1")), { challenge: { id: "c1" }, entries: [] });

    clearCache();
    assert.equal(readCache(CACHE_KEYS.bootstrap), null);
    assert.equal(readCache(CACHE_KEYS.challenge("c1")), null);
  } finally {
    restore();
  }
});

test("continua funcionando quando o sessionStorage lança", () => {
  const restore = withWindow(() => { throw new Error("bloqueado"); });
  try {
    clearCache();
    writeCache(CACHE_KEYS.bootstrap, { user: { id: "u2" } });
    // O espelho em memória ainda serve a aba atual.
    assert.deepEqual(readCache(CACHE_KEYS.bootstrap), { user: { id: "u2" } });
    clearCache();
    assert.equal(readCache(CACHE_KEYS.bootstrap), null);
  } finally {
    restore();
  }
});
