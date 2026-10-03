/**
 * "Organise for the group": an order for a list that's easier to follow, from whatever the items carry.
 *
 * Goa doesn't need to know what a property means, only its kind:
 *  - a number (runtime, pages, an "Attention" 1–5) is put on 0–1 within this list, and two high ones side by
 *    side cost a penalty (three 3-hour films don't end up back to back; low values never cost anything);
 *  - a category (genre, director, who recommended it) costs when the same value repeats right next to itself,
 *    and a little when it repeats one item apart. Who recommended it also gets a fairness term, so nobody's
 *    picks all land at the start.
 * Every chosen property weighs the same. The order is found greedily from several starting points, then
 * improved by swapping pairs; the same input always gives the same order, and `attempt` asks for another.
 * Pinned items (already logged, on a running challenge) keep their place; the rest fill the free slots.
 */

export type TraitKind = "number" | "category";

export interface Trait {
  key: string;
  label: string;
  kind: TraitKind;
  /** Spread so nobody's items cluster at the start or the end (who recommended it). */
  fair?: boolean;
}

export interface OrganiseItem {
  key: string;
  values: Record<string, number | string | null | undefined>;
  /** Keeps its current place. */
  pinned?: boolean;
}

export interface TraitReport {
  key: string;
  label: string;
  kind: TraitKind;
  /** Neighbours that still clash (two high numbers side by side, or the same value twice in a row). */
  clashes: number;
  /** Clashes the list had before. */
  before: number;
  /** For a category: the value that keeps repeating, when it can't be avoided. */
  crowded?: string | null;
  /** For a fair category: the distinct values, in the order they first appear. */
  values?: string[];
}

const HIGH = 2 / 3;
const NEAR = 0.4;
const STARTS = 12;

type Prepared = { trait: Trait; at: (index: number) => number | string | null };

function prepare(items: OrganiseItem[], traits: Trait[]): Prepared[] {
  return traits.flatMap((trait): Prepared[] => {
    if (trait.kind === "number") {
      const numbers = items.map((item) => (typeof item.values[trait.key] === "number" && Number.isFinite(item.values[trait.key]) ? item.values[trait.key] as number : null));
      const known = numbers.filter((value): value is number => value !== null);
      if (known.length < 2) return [];
      const lo = Math.min(...known);
      const hi = Math.max(...known);
      if (hi === lo) return [];
      return [{ trait, at: (index: number) => (numbers[index] === null ? null : (numbers[index]! - lo) / (hi - lo)) }];
    }
    const labels = items.map((item) => {
      const value = item.values[trait.key];
      return value === null || value === undefined || value === "" ? null : String(value).trim().toLowerCase();
    });
    if (new Set(labels.filter(Boolean)).size < 2 && labels.filter(Boolean).length < 2) return [];
    return [{ trait, at: (index: number) => labels[index] }];
  });
}

/** How much two neighbours (`gap` apart) clash on one property. */
function clash(prepared: Prepared, a: number, b: number, gap: number): number {
  const x = prepared.at(a);
  const y = prepared.at(b);
  if (x === null || y === null) return 0;
  if (prepared.trait.kind === "number") {
    if (gap > 1) return 0;
    const over = (value: number) => Math.max(0, value - 0.5) * 2;
    return over(x as number) * over(y as number);
  }
  return x === y ? (gap === 1 ? 1 : NEAR) : 0;
}

/** Fairness: how far each value's running count drifts from an even spread along the order. */
function drift(prepared: Prepared, order: number[]): number {
  const totals = new Map<string, number>();
  for (const index of order) {
    const value = prepared.at(index);
    if (value !== null) totals.set(String(value), (totals.get(String(value)) ?? 0) + 1);
  }
  if (totals.size < 2) return 0;
  const seen = new Map<string, number>();
  let cost = 0;
  order.forEach((index, position) => {
    const value = prepared.at(index);
    if (value !== null) seen.set(String(value), (seen.get(String(value)) ?? 0) + 1);
    for (const [key, total] of totals) {
      const expected = ((position + 1) * total) / order.length;
      cost += ((seen.get(key) ?? 0) - expected) ** 2;
    }
  });
  return cost / (order.length * totals.size);
}

function cost(prepared: Prepared[], order: number[]): number {
  let total = 0;
  for (const property of prepared) {
    let sum = 0;
    for (let position = 1; position < order.length; position += 1) {
      sum += clash(property, order[position - 1], order[position], 1);
      if (position > 1) sum += clash(property, order[position - 2], order[position], 2);
    }
    // Normalised per property, so every chosen property weighs the same whatever its spread.
    total += sum / Math.max(1, order.length - 1) + (property.trait.fair ? drift(property, order) : 0);
  }
  return total;
}

function clashes(property: Prepared, order: number[]): number {
  let count = 0;
  for (let position = 1; position < order.length; position += 1) {
    const a = property.at(order[position - 1]);
    const b = property.at(order[position]);
    if (a === null || b === null) continue;
    if (property.trait.kind === "number" ? (a as number) >= HIGH && (b as number) >= HIGH : a === b) count += 1;
  }
  return count;
}

/** How much `candidate` clashes with the (up to) two items placed before it. */
function local(prepared: Prepared[], order: number[], candidate: number): number {
  let total = 0;
  for (const property of prepared) {
    if (order.length >= 1) total += clash(property, order[order.length - 1], candidate, 1);
    if (order.length >= 2) total += clash(property, order[order.length - 2], candidate, 2);
  }
  return total;
}

/** Fills the free slots (`null` in `slots`) with `free`: `start` first, then whatever clashes least each time. */
function greedy(prepared: Prepared[], slots: Array<number | null>, free: number[], start: number): number[] {
  const order: number[] = [];
  const left = free.filter((index) => index !== start);
  let first = true;
  for (const slot of slots) {
    if (slot !== null) { order.push(slot); continue; }
    if (first) { order.push(start); first = false; continue; }
    let best = 0;
    let bestCost = Infinity;
    left.forEach((candidate, index) => {
      const value = local(prepared, order, candidate);
      if (value < bestCost - 1e-12) { bestCost = value; best = index; }
    });
    order.push(left[best]);
    left.splice(best, 1);
  }
  return order;
}

/** Swaps pairs of free positions while that lowers the cost. */
function improve(prepared: Prepared[], order: number[], movable: boolean[]): number[] {
  let current = [...order];
  let currentCost = cost(prepared, current);
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    for (let i = 0; i < current.length; i += 1) {
      if (!movable[i]) continue;
      for (let j = i + 1; j < current.length; j += 1) {
        if (!movable[j]) continue;
        const trial = [...current];
        [trial[i], trial[j]] = [trial[j], trial[i]];
        const trialCost = cost(prepared, trial);
        if (trialCost < currentCost - 1e-9) { current = trial; currentCost = trialCost; changed = true; }
      }
    }
    if (!changed) break;
  }
  return current;
}

export interface Organised {
  /** The item keys in their new order. */
  order: string[];
  report: TraitReport[];
  /** Whether the order differs from the current one. */
  changed: boolean;
}

/** The best order for `items` by the chosen `traits`; `attempt` (0, 1, 2…) gives the next-best alternatives. */
export function organiseList(items: OrganiseItem[], traits: Trait[], attempt = 0): Organised {
  const prepared = prepare(items, traits);
  const identity = items.map((_, index) => index);
  const slots = items.map((item, index) => (item.pinned ? index : null));
  const free = identity.filter((index) => !items[index].pinned);
  const movable = slots.map((slot) => slot === null);
  let order = identity;
  if (prepared.length && free.length > 1) {
    const starts = free.slice(0, Math.min(free.length, STARTS));
    const candidates = starts
      .map((start) => improve(prepared, greedy(prepared, slots, free, start), movable))
      .map((candidate) => ({ candidate, value: cost(prepared, candidate) }))
      .filter((entry, index, list) => list.findIndex((other) => other.candidate.join() === entry.candidate.join()) === index)
      .sort((a, b) => a.value - b.value);
    order = candidates[Math.min(attempt, candidates.length - 1)].candidate;
  }
  const report = prepared.map((property): TraitReport => {
    const values = property.trait.kind === "category"
      ? [...new Set(order.map((index) => items[index].values[property.trait.key]).filter((value): value is string | number => value !== null && value !== undefined && value !== "").map(String))]
      : undefined;
    const counts = new Map<string, number>();
    for (const index of order) {
      const value = property.at(index);
      if (value !== null && property.trait.kind === "category") counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
    }
    const crowded = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const after = clashes(property, order);
    return {
      key: property.trait.key,
      label: property.trait.label,
      kind: property.trait.kind,
      clashes: after,
      before: clashes(property, identity),
      ...(property.trait.kind === "category"
        ? { crowded: after && crowded ? order.map((index) => items[index].values[property.trait.key]).map(String).find((value) => value.trim().toLowerCase() === crowded[0]) ?? null : null, values }
        : {}),
    };
  });
  return { order: order.map((index) => items[index].key), report, changed: order.some((value, index) => value !== index) };
}

/** Properties worth offering: those filled in on at least two items with two different values. */
export function usableTraits(items: OrganiseItem[], traits: Trait[]): Trait[] {
  return traits.filter((trait) => prepare(items, [trait]).length > 0);
}

/** Pre-ticked: filled in on at least half the items. Year is offered but left off — spreading years is rarely the point. */
export function suggestedTraits(items: OrganiseItem[], traits: Trait[]): string[] {
  return usableTraits(items, traits)
    .filter((trait) => trait.key !== "year")
    .filter((trait) => items.filter((item) => item.values[trait.key] !== null && item.values[trait.key] !== undefined && item.values[trait.key] !== "").length * 2 >= items.length)
    .map((trait) => trait.key);
}
