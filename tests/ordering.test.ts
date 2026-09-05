import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOrder,
  checkpointTimeframe,
  seededShuffle,
  type OrderableItem,
} from "../app/goa/ordering";

function items(count: number, checkpointId: string | null = null): OrderableItem[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `k${index}`,
    checkpointId,
    position: index,
  }));
}

test("original order just renumbers positions 0..n-1", () => {
  const scrambled: OrderableItem[] = [
    { key: "a", checkpointId: null, position: 5 },
    { key: "b", checkpointId: null, position: 2 },
    { key: "c", checkpointId: null, position: 9 },
  ];
  const result = applyOrder(scrambled, { kind: "original" });
  assert.deepEqual(result.map((row) => row.key), ["b", "a", "c"]);
  assert.deepEqual(result.map((row) => row.position), [0, 1, 2]);
});

test("manual order follows the given key list, unknown keys sink to the end", () => {
  const result = applyOrder(items(4), { kind: "manual", order: ["k2", "k0"] });
  assert.deepEqual(result.map((row) => row.key), ["k2", "k0", "k1", "k3"]);
  assert.deepEqual(result.map((row) => row.position), [0, 1, 2, 3]);
});

test("seeded shuffle is deterministic for a seed and differs across seeds", () => {
  const a = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], "seed-1");
  const b = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], "seed-1");
  const c = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], "seed-2");
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual([...a].sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("shuffle preserves the set of items and renumbers", () => {
  const result = applyOrder(items(10), { kind: "shuffle", seed: "reshuffle-3" });
  assert.deepEqual([...result.map((row) => row.key)].sort(), items(10).map((row) => row.key).sort());
  assert.deepEqual(result.map((row) => row.position), Array.from({ length: 10 }, (_, index) => index));
});

test("shuffle_within keeps each checkpoint's members inside that checkpoint", () => {
  const mixed: OrderableItem[] = [
    ...items(3, "w1"),
    ...items(3, "w2").map((row) => ({ ...row, key: `${row.key}-b` })),
  ];
  const result = applyOrder(mixed, { kind: "shuffle_within", seed: "x" });
  const w1 = result.filter((row) => row.checkpointId === "w1").map((row) => row.key).sort();
  const w2 = result.filter((row) => row.checkpointId === "w2").map((row) => row.key).sort();
  assert.deepEqual(w1, ["k0", "k1", "k2"]);
  assert.deepEqual(w2, ["k0-b", "k1-b", "k2-b"]);
});

test("distribute spreads items round-robin across the checkpoint list", () => {
  const result = applyOrder(items(7), { kind: "distribute", checkpointIds: ["w1", "w2", "w3"] });
  assert.deepEqual(result.map((row) => row.checkpointId), ["w1", "w2", "w3", "w1", "w2", "w3", "w1"]);
});

test("distribute with a seed still fills every checkpoint evenly", () => {
  const result = applyOrder(items(6), { kind: "distribute", checkpointIds: ["a", "b"], seed: "s" });
  const counts = result.reduce<Record<string, number>>((acc, row) => {
    acc[row.checkpointId ?? "-"] = (acc[row.checkpointId ?? "-"] ?? 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(counts, { a: 3, b: 3 });
});

test("checkpointTimeframe splits past / current / future around now", () => {
  const now = Date.parse("2026-03-15T12:00:00Z");
  assert.equal(checkpointTimeframe("2026-03-20T00:00:00Z", "2026-03-27T00:00:00Z", now), "future");
  assert.equal(checkpointTimeframe("2026-03-01T00:00:00Z", "2026-03-08T00:00:00Z", now), "past");
  assert.equal(checkpointTimeframe("2026-03-10T00:00:00Z", "2026-03-17T00:00:00Z", now), "current");
  assert.equal(checkpointTimeframe(null, null, now), "current");
});
