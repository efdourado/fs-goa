import assert from "node:assert/strict";
import test from "node:test";

import { organiseList, suggestedTraits, type OrganiseItem, type Trait } from "../app/goa/organize-list";

const RUNTIME: Trait = { key: "runtime", label: "Runtime", kind: "number" };
const GENRE: Trait = { key: "genre", label: "Genre", kind: "category" };
const PICKER: Trait = { key: "picker", label: "Recommended by", kind: "category", fair: true };
const at = (order: string[], key: string) => order.indexOf(key);

test("three 3-hour films never end up back to back", () => {
  const items: OrganiseItem[] = [
    { key: "long1", values: { runtime: 180 } }, { key: "long2", values: { runtime: 175 } }, { key: "long3", values: { runtime: 190 } },
    { key: "s1", values: { runtime: 90 } }, { key: "s2", values: { runtime: 95 } }, { key: "s3", values: { runtime: 100 } },
  ];
  const { order, report } = organiseList(items, [RUNTIME]);
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(!(order[i - 1].startsWith("long") && order[i].startsWith("long")), `no two long ones together: ${order.join(", ")}`);
  }
  assert.equal(report[0].before, 2);
  assert.equal(report[0].clashes, 0);
});

test("one person's five picks never sit together, and don't all land at the start", () => {
  const items: OrganiseItem[] = [
    ...["a1", "a2", "a3", "a4", "a5"].map((key) => ({ key, values: { picker: "Ana" } })),
    ...["b1", "b2", "b3"].map((key) => ({ key, values: { picker: "Bia" } })),
    ...["c1", "c2"].map((key) => ({ key, values: { picker: "Caio" } })),
  ];
  const { order, report } = organiseList(items, [PICKER]);
  for (let i = 1; i < order.length; i += 1) assert.notEqual(order[i - 1][0], order[i][0], `no picker twice in a row: ${order.join(", ")}`);
  const anaFirstHalf = order.slice(0, 5).filter((key) => key.startsWith("a")).length;
  assert.ok(anaFirstHalf <= 3, `Ana's picks are spread: ${order.join(", ")}`);
  assert.equal(report[0].clashes, 0);
  assert.deepEqual(new Set(report[0].values), new Set(["Ana", "Bia", "Caio"]));
});

test("properties combine: genre and runtime both get spread", () => {
  const items: OrganiseItem[] = [
    { key: "d1", values: { genre: "Drama", runtime: 170 } }, { key: "d2", values: { genre: "Drama", runtime: 100 } },
    { key: "d3", values: { genre: "Drama", runtime: 95 } }, { key: "c1", values: { genre: "Comedy", runtime: 180 } },
    { key: "c2", values: { genre: "Comedy", runtime: 90 } }, { key: "h1", values: { genre: "Horror", runtime: 88 } },
  ];
  const { report } = organiseList(items, [GENRE, RUNTIME]);
  assert.equal(report.find((row) => row.key === "genre")!.clashes, 0);
  assert.equal(report.find((row) => row.key === "runtime")!.clashes, 0);
});

test("when a value can't avoid repeating, the report says which", () => {
  const items: OrganiseItem[] = [
    ...["d1", "d2", "d3", "d4"].map((key) => ({ key, values: { genre: "Drama" } })),
    { key: "c1", values: { genre: "Comedy" } },
  ];
  const { report } = organiseList(items, [GENRE]);
  assert.ok(report[0].clashes > 0);
  assert.equal(report[0].crowded, "Drama");
});

test("pinned items keep their place; missing values are ignored; same input, same order", () => {
  const items: OrganiseItem[] = [
    { key: "seen", values: { runtime: 180 }, pinned: true },
    { key: "x", values: { runtime: 175 } }, { key: "y", values: {} }, { key: "z", values: { runtime: 90 } },
  ];
  const first = organiseList(items, [RUNTIME]);
  assert.equal(first.order[0], "seen");
  assert.notEqual(at(first.order, "x"), 1, "the other long film doesn't sit next to the pinned one");
  assert.deepEqual(organiseList(items, [RUNTIME]).order, first.order);
});

test("another attempt gives a different valid order when there is one", () => {
  const items: OrganiseItem[] = ["a1", "a2", "b1", "b2", "c1", "c2"].map((key) => ({ key, values: { picker: key[0] } }));
  const one = organiseList(items, [PICKER], 0).order;
  const two = organiseList(items, [PICKER], 1).order;
  assert.notDeepEqual(one, two);
});

test("suggested properties: filled on half the items, year left off", () => {
  const items: OrganiseItem[] = [
    { key: "1", values: { runtime: 100, genre: "Drama", year: 1999, author: "X" } },
    { key: "2", values: { runtime: 180, genre: "Comedy", year: 2005 } },
    { key: "3", values: { runtime: 90, year: 2010 } },
    { key: "4", values: { runtime: 120, year: 2020 } },
  ];
  const traits: Trait[] = [RUNTIME, GENRE, { key: "year", label: "Year", kind: "number" }, { key: "author", label: "Author", kind: "category" }];
  assert.deepEqual(suggestedTraits(items, traits), ["runtime", "genre"]);
});
