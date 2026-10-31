import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { CatalogItemPage } from "../app/goa/screens/catalog-item";
import { ptFormat, renderWithIntl } from "./helpers/intl";

import { COVER_TONES, coverToneOf } from "../app/goa/catalog-cover";
import { CatalogRow, decadeOf, groupCatalogItems, resolveCoverTop } from "../app/goa/catalog-views";

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
  assert.deepEqual(ids(groupCatalogItems(items, "none")), [["", "abcde"]]);
  assert.deepEqual(ids(groupCatalogItems(items, "genre")), [["Drama", "ac"], ["sci-fi", "be"], ["", "d"]], "genres A→Z, matched without regard to case");
  assert.deepEqual(ids(groupCatalogItems(items, "decade")), [["2020s", "ac"], ["1970s", "be"], ["", "d"]], "decades newest first");
  assert.deepEqual(ids(groupCatalogItems(items, "year")), [["2023", "c"], ["2021", "a"], ["1979", "b"], ["1972", "e"], ["", "d"]]);
});

test("decadeOf floors a year to its decade", () => {
  assert.equal(decadeOf(1994), "1990s");
  assert.equal(decadeOf(2000), "2000s");
});

test("numeric cover values include zero and custom properties can use year as their name", () => {
  const item = { year: null, attributes: [{ key: "year", label: "Ano", type: "number" as const, value: 0 }] };
  assert.equal(resolveCoverTop(item, "year", ptFormat), 0);
  const html = renderWithIntl(createElement(CatalogRow, { title: "A", year: 0, ratingLabel: "", meta: [], onOpen: () => undefined }));
  assert.match(html, />0<\/span>/);
});

test("item details keep original label casing and place the rating between item details and history", () => {
  const html = renderWithIntl(createElement(CatalogItemPage, {
    item: { id: "book", kind: "book", title: "Um título longo para a página do item", ratingAvg: 4.2, ratingCount: 2,
      attributes: [{ key: "nota", label: "Minhas Observações", type: "text", value: "Uma anotação extensa que precisa caber em telas pequenas sem perder o conteúdo." }],
      rounds: [{ challengeId: "round", title: "O histórico continua com o título completo do desafio", status: "active", startsOn: null, endsOn: null, ratingAvg: 4.2, ratingCount: 2 }],
    },
    library: { id: "lib", kind: "book", source: "pages", label: "Livros da Família", position: 0, coverTopProperty: "none", coverBadgeHidden: false },
    onBack: () => undefined, onOpenChallenge: () => undefined,
    editAction: createElement("button", { "aria-label": "Editar item" }, "Editar"),
  }));
  assert.match(html, /Livros da Família/);
  assert.match(html, /Minhas Observações/);
  assert.doesNotMatch(html, /uppercase/);
  assert.match(html, /aria-label="Editar item"/);
  assert.ok(html.indexOf("<h1") < html.indexOf('role="img"'));
  assert.ok(html.indexOf("Minhas Observações") < html.indexOf('role="img"'));
  assert.ok(html.indexOf('role="img"') < html.indexOf('class="catalog-item-history"'));
  assert.match(html, /O histórico continua com o título completo do desafio/);
});

test("collection details respect property names and visibility and retain zero and false", () => {
  const html = renderWithIntl(createElement(CatalogItemPage, {
    item: { id: "book", kind: "book", title: "Solaris", author: "Hidden author", year: 1961, ratingAvg: null,
      attributes: [{ key: "copies", label: "Exemplares", type: "number", value: 0 }, { key: "read", label: "Lido", type: "boolean", value: false }], rounds: [] },
    library: null,
    properties: [
      { key: "author", storage: "native", label: "Escritor", type: "text", hidden: true, position: 1, canHide: true },
      { key: "year", storage: "native", label: "Publicado em", type: "number", hidden: false, position: 2, canHide: true },
    ],
    onBack: () => undefined, onOpenChallenge: () => undefined,
  }));
  assert.match(html, /Publicado em/);
  assert.doesNotMatch(html, /Hidden author|Escritor/);
  assert.match(html, /<dt>Exemplares<\/dt><dd>0<\/dd>/);
  assert.match(html, /<dt>Lido<\/dt><dd>Não<\/dd>/);
  assert.doesNotMatch(html, /role="img"/);
  assert.match(html, /Histórico/);
});
