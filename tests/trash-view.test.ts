import assert from "node:assert/strict";
import { createElement } from "react";
import test from "node:test";

import { TrashLoadState, trashRows } from "../app/goa/trash-view";
import type { TrashItem } from "../app/goa/types";
import { renderWithIntl } from "./helpers/intl";

const item = (id: string, kind: TrashItem["kind"]): TrashItem => ({
  id, kind, label: id, deletedAt: null, deletedBy: null, reason: null,
  dependencies: [], parentTrashed: false, blocked: null,
});

test("personal and group bins display the items returned by the API", () => {
  const items = [item("challenge", "challenge"), item("catalog", "catalog_item")];
  assert.deepEqual(trashRows("personal", { items }), items);
  assert.deepEqual(trashRows("group", { items }), items);
});

test("challenge archive includes both removed structure and deleted evaluations", () => {
  const structure = [item("field", "field"), item("metric", "metric")];
  const entries = [item("evaluation", "entry")];
  assert.deepEqual(trashRows("challenge", { structure, entries }), [...structure, ...entries]);
  assert.deepEqual(trashRows("challenge", { entries }), entries);
});

test("failed initial bin loads show an error and retry, never an empty bin", () => {
  const html = renderWithIntl(createElement(TrashLoadState, {
    loading: true, error: "Não foi possível abrir a lixeira.", onRetry: () => undefined,
  }));
  assert.match(html, /Não foi possível abrir a lixeira/);
  assert.match(html, /Tentar novamente/);
  assert.doesNotMatch(html, /A lixeira está vazia/);
});

test("loading and a successfully loaded empty bin remain distinct states", () => {
  const render = (loading: boolean) => renderWithIntl(createElement(TrashLoadState, {
    loading, error: null, onRetry: () => undefined,
  }));
  assert.doesNotMatch(render(true), /A lixeira está vazia/);
  assert.match(render(false), /A lixeira está vazia/);
  for (const scope of ["personal", "group", "challenge"] as const) {
    assert.deepEqual(trashRows(scope, {}), []);
  }
});
