import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { CatalogShelfView } from "../app/goa/catalog-shelf";
import { renderWithIntl } from "./helpers/intl";

import { COVER_TONES, coverToneOf } from "../app/goa/catalog-cover";
import { CatalogRow, decadeOf, groupCatalogItems } from "../app/goa/catalog-views";
import { valueFromItem } from "../app/goa/property-inputs";
import type { LibraryProperty } from "../app/goa/types";

test("a title always gets the same cover colour, and the same title in any case or spacing agrees", () => {
  assert.equal(coverToneOf("Solaris"), coverToneOf("  SOLARIS "));
  assert.ok(COVER_TONES.includes(coverToneOf("Aftersun")));
  const seen = new Set(["Aftersun", "Solaris", "Stalker", "Burning", "Past Lives", "Perfect Days", "Drive My Car", "Paris, Texas"].map(coverToneOf));
  assert.ok(seen.size >= 3, "different titles spread across the palette");
});

test("grouping keeps the sort inside each section, orders sections, and sends items without the field last", () => {
  const items = [
    { t: "a", year: 2021, mainGenre: "Drama" },
    { t: "b", year: 1979, mainGenre: "sci-fi" },
    { t: "c", year: 2023, mainGenre: "Drama" },
    { t: "d", year: null, mainGenre: null },
    { t: "e", year: 1972, mainGenre: "Sci-fi" },
  ];
  const ids = (groups: ReturnType<typeof groupCatalogItems<(typeof items)[number]>>) => groups.map((group) => [group.label, group.items.map((item) => item.t).join("")]);
  const newestFirst = (left: string, right: string) => parseInt(right, 10) - parseInt(left, 10);
  assert.deepEqual(ids(groupCatalogItems(items)), [["", "abcde"]]);
  assert.deepEqual(ids(groupCatalogItems(items, (item) => item.mainGenre ?? "")), [["Drama", "ac"], ["sci-fi", "be"], ["", "d"]], "genres A→Z, matched without regard to case");
  assert.deepEqual(ids(groupCatalogItems(items, (item) => item.year == null ? "" : decadeOf(item.year), newestFirst)), [["2020s", "ac"], ["1970s", "be"], ["", "d"]], "decades newest first");
  assert.deepEqual(ids(groupCatalogItems(items, (item) => item.year == null ? "" : String(item.year), newestFirst)), [["2023", "c"], ["2021", "a"], ["1979", "b"], ["1972", "e"], ["", "d"]]);
});

test("custom properties group by the stored attribute key and retain zero and false", () => {
  const priority: LibraryProperty = { key: "definition-1", attributeKey: "priority", type: "number", storage: "attribute", label: "Prioridade", hidden: false, position: 1, canHide: true };
  const done: LibraryProperty = { ...priority, key: "definition-2", attributeKey: "done", type: "boolean", label: "Feito" };
  const item = { attributes: [{ key: "priority", type: "number" as const, value: 0, label: "Prioridade" }, { key: "done", type: "boolean" as const, value: false, label: "Feito" }] };
  assert.deepEqual(groupCatalogItems([item, {}], (row) => valueFromItem(priority, row)).map(({ label }) => label), ["0", ""]);
  assert.deepEqual(groupCatalogItems([item, {}], (row) => valueFromItem(done, row)).map(({ label }) => label), ["false", ""]);
});

test("decadeOf floors a year to its decade", () => {
  assert.equal(decadeOf(1994), "1990s");
  assert.equal(decadeOf(2000), "2000s");
});

test("catalogue rows keep every value on a single truncating line without an item link", () => {
  const html = renderWithIntl(createElement(CatalogRow, { title: "Solaris", meta: ["Stanisław Lem", "1961", "204", "0", "Não"] }));
  assert.match(html, /<strong[^>]*>Solaris<\/strong>/);
  assert.match(html, /<small[^>]*><span[^>]*class="catalog-property-text block truncate"[^>]*>Stanisław Lem · 1961 · 204 · 0 · Não<\/span><\/small>/);
  assert.doesNotMatch(html, /<button|<a\b/);
});

test("catalogue shelves show unlabeled item values and respect hidden native properties", () => {
  const html = renderWithIntl(createElement(CatalogShelfView, {
    scope: "personal", canManage: true, onOpenCatalog: () => undefined,
    data: {
      libraries: [{ id: "lib", kind: "book", source: "pages", label: null, position: 0, coverTopProperty: "page_count", coverBadgeHidden: false }],
      counts: { book: 1 },
      hiddenProperties: { book: ["author"] },
      items: [{ id: "book", kind: "book", title: "Solaris", author: "Hidden author", year: 1961, pageCount: 204, ratingAvg: 4.2,
        attributes: [{ key: "copies", label: "Exemplares", type: "number", value: 0 }, { key: "read", label: "Lido", type: "boolean", value: false }] }],
    },
  }));
  assert.match(html, /Solaris/);
  assert.match(html, /1961 · 204 · 0 · Não/);
  assert.doesNotMatch(html, /em Coleção/);
  assert.doesNotMatch(html, /role="img"|>4\.2<|Hidden author|Exemplares:|Lido:|Páginas:/);
});

test("the group and home shelves use plain headings and the same end card", () => {
  const data = {
    libraries: [],
    counts: { film: 8, book: 5 },
    items: Array.from({ length: 11 }, (_, index) => ({
      id: String(index),
      kind: index % 2 ? "film" : "book",
      title: `Capa ${index}`,
      createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    })),
  };
  const props = { canManage: true, onOpenCatalog: () => undefined, data };
  const home = renderWithIntl(createElement(CatalogShelfView, { ...props, scope: "personal" }));
  const group = renderWithIntl(createElement(CatalogShelfView, { ...props, scope: { groupId: "g" } }));
  const covers = (html: string) => [...html.matchAll(/title="(Capa \d+)"/g)].map((match) => match[1]);
  assert.deepEqual(covers(group), covers(home));
  assert.equal(covers(group).length, 10);
  assert.match(group, /<h2[^>]*>Coleção<\/h2>/);
  assert.match(home, /<h2[^>]*>Coleção<\/h2>/);
  assert.doesNotMatch(group, /Catálogo do grupo/);
  assert.match(group, />13<\/span>.*>em Coleção<\/span>.*>Ver</);
  assert.match(home, />13<\/span>.*>em Coleção<\/span>.*>Ver</);

  const allVisible = renderWithIntl(createElement(CatalogShelfView, {
    ...props, scope: { groupId: "g" }, data: { ...data, counts: { film: 5, book: 5 }, items: data.items.slice(0, 10) },
  }));
  assert.equal(covers(allVisible).length, 10);
  assert.doesNotMatch(allVisible, /em Coleção/);
});

test("an empty group catalogue has no shelf, even for managers", () => {
  const props = { canManage: true, onOpenCatalog: () => undefined, data: { libraries: [], counts: {}, items: [] } };
  assert.equal(renderWithIntl(createElement(CatalogShelfView, { ...props, scope: { groupId: "g" } })), "");
  assert.match(renderWithIntl(createElement(CatalogShelfView, { ...props, scope: "personal" })), /Comece a coleção/);
});
