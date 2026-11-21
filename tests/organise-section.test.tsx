import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";

import { CheckpointPlanner } from "../app/goa/checkpoint-planner";
import { OrganiseDialog, organiseFromItems } from "../app/goa/organize-panel";
import { builtInProperties } from "../app/goa/property-inputs";
import type { ChallengeDetail, LibraryProperty } from "../app/goa/types";
import { renderWithIntl } from "./helpers/intl";

const book = (id: string, year: number, author: string) => ({ id, title: id, position: 0, catalogItem: { id: `c-${id}`, kind: "book", title: id, year, author } });
const challenge = (items: ReturnType<typeof book>[], status = "active") => ({
  id: "c", status, submissionMode: "item", libraries: [{ id: null, kind: "book", source: "pages", label: null }], items, checkpoints: [],
} as unknown as ChallengeDetail);
const noop = async () => undefined;
const plannerActions = { itemTools: { scope: "personal" as const, onAdd: noop, onUpdate: noop, onRemove: noop }, onAssign: noop, onSaveCheckpoints: noop };
const bookProperties = new Map([["book", builtInProperties("book")]]);

test("Itens e etapas mostra Organizar imediatamente à esquerda de Adicionar itens", () => {
  const html = renderWithIntl(createElement(CheckpointPlanner, {
    ...plannerActions, challenge: challenge([book("a", 2001, "X"), book("b", 2010, "Y"), book("c", 2020, "X")]), entries: [],
  }));
  assert.match(html, /aria-label="Organizar"[^>]*h-10 w-10[^>]*rounded-full[^>]*><svg[^>]*>.*<span class="hidden sm:inline">Organizar<\/span><\/button><button[^>]*aria-label="Adicionar itens"/);
});

test("sem itens livres suficientes (os registrados ficam no lugar), Organizar não aparece", () => {
  const items = [book("a", 2001, "X"), book("b", 2010, "Y"), book("c", 2020, "X")];
  const html = renderWithIntl(createElement(CheckpointPlanner, {
    ...plannerActions, challenge: challenge(items), entries: [{ id: "e", itemId: "a", values: {} }] as never,
  }));
  assert.doesNotMatch(html, /aria-label="Organizar"/);
  assert.match(html, /aria-label="Adicionar itens"/);
});

test("a prévia alinha os números pelo total de itens", () => {
  for (const [count, first] of [[9, "1"], [10, "01"], [100, "001"], [1000, "0001"]] as const) {
    const items = challenge(Array.from({ length: count }, (_, index) => book(`item-${index}`, 2000 + index, `autor-${index % 3}`))).items;
    const input = organiseFromItems(items, bookProperties, new Set(), ({ key }) => key);
    // Only preview formatting is under test here. Keeping the rows pinned skips the search.
    input.items.forEach((item) => { item.pinned = true; });
    const html = renderWithIntl(createElement(OrganiseDialog, { input, onApply: noop, onClose: noop }));
    const positions = [...html.matchAll(/tabular-nums[^>]*>(\d+)<\/span>/g)].map((match) => match[1]);
    assert.equal(positions[0], first);
    assert.equal(positions.at(-1), String(count));
  }
});

test("Organizar usa um check circular e uma seta sem texto para tentar outra ordem", () => {
  const items = challenge([book("a", 2001, "X"), book("b", 2010, "Y"), book("c", 2020, "X")]).items;
  const input = organiseFromItems(items, bookProperties, new Set(), ({ key }) => key);
  const html = renderWithIntl(createElement(OrganiseDialog, { input, onApply: noop, onClose: noop }));
  assert.match(html, /aria-pressed="true"[^>]*><svg[^>]*><circle/);
  assert.match(html, /aria-label="Tentar outra"[^>]*text-\[var\(--ink\)\][^>]*><svg[^>]*><path[^>]*><\/path><\/svg><\/button><button[^>]*type="submit"[^>]*>Aplicar ordem/);
  assert.doesNotMatch(html, /Nova ordem/);
});

test("Organizar usa nomes, tipos e chaves de armazenamento da biblioteca", () => {
  const properties: LibraryProperty[] = builtInProperties("book").map((property) => ({
    ...property,
    label: property.key === "author" ? "Escritora" : null,
    hidden: property.key === "year",
  }));
  properties.push({ key: "attr-id", attributeKey: "attention", label: "Atenção", hidden: false, type: "number", storage: "attribute", canHide: true, position: 5 });
  const row = book("a", 2001, "X");
  const input = organiseFromItems([{ ...row, catalogItem: { ...row.catalogItem, mainGenre: "Drama", attributes: [{ key: "attention", label: "Atenção", type: "number", value: 4 }] } }], new Map([["book", properties]]), new Set(), ({ key, label }) => label ?? (key === "main_genre" ? "Gênero principal" : key));
  assert.deepEqual(input.traits.map(({ label, kind }) => [label, kind]), [["Escritora", "category"], ["Gênero principal", "category"], ["page_count", "number"], ["Atenção", "number"]]);
  assert.deepEqual(Object.values(input.items[0].values), ["X", "Drama", null, 4]);
});
