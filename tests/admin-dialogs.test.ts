import assert from "node:assert/strict";
import { createElement } from "react";
import test from "node:test";

import { ConfirmDialog } from "../app/goa/dialog";
import { EditCatalogItemDialog } from "../app/goa/catalog-item-dialogs";
import { FieldEditorDialog, ItemEditorDialog } from "../app/goa/screens/admin";
import type { ChallengeDetail, ChallengeItem } from "../app/goa/types";
import { renderWithIntl } from "./helpers/intl";

const noop = async () => undefined;

test("ConfirmDialog renders the explanation and a danger confirm button", () => {
  const html = renderWithIntl(createElement(ConfirmDialog, {
    title: "Encerrar o desafio?",
    body: "Os registros ficam bloqueados até você reabrir.",
    confirmLabel: "Encerrar desafio",
    danger: true,
    onConfirm: noop,
    onClose: () => undefined,
  }));
  assert.match(html, /Encerrar o desafio\?/);
  assert.match(html, /Os registros ficam bloqueados/);
  assert.match(html, />Encerrar desafio</);
  // No native window.confirm — it's a real dialog with its own markup.
  assert.match(html, /<dialog/);
});

test("FieldEditorDialog shows the type-specific config for a number field", () => {
  const html = renderWithIntl(createElement(FieldEditorDialog, {
    field: { key: "paginas", label: "Páginas", type: "number", required: true, config: { step: 1 } },
    takenKeys: [],
    lockType: false,
    onCancel: () => undefined,
    onSave: noop,
  }));
  assert.match(html, /Editar campo/);
  assert.match(html, /value="Páginas"/);
  // number → min / max / step inputs from FieldConfigInputs
  assert.match(html, /Mínimo/);
  assert.match(html, /Máximo/);
  assert.match(html, /Intervalo/);
  assert.match(html, /type="submit">Salvar</);
});

test("FieldEditorDialog names a rating's fixed scale in its type, with its two switches side by side", () => {
  const html = renderWithIntl(createElement(FieldEditorDialog, {
    field: { key: "nota", label: "Nota", type: "rating", required: true, config: { min: 0, max: 5, step: 0.5 } },
    takenKeys: [], lockType: false, onCancel: () => undefined, onSave: noop,
  }));
  assert.match(html, /Nota \(0 a 5, de meio em meio ponto\)/);
  assert.match(html, /sm:grid-cols-2"><div[^>]*>[\s\S]*Conta para o ranking[\s\S]*Preenchimento obrigatório/);
  assert.doesNotMatch(html, /Mínimo/);
});

test("FieldEditorDialog in add mode has no field and a create action", () => {
  const html = renderWithIntl(createElement(FieldEditorDialog, {
    takenKeys: ["nota"], lockType: false, onCancel: () => undefined, onSave: noop,
  }));
  assert.match(html, /Adicionar campo/);
  assert.doesNotMatch(html, /type="submit">Salvar</);
});

const catalogChallenge = {
  submissionMode: "item",
  status: "active",
  entryTypes: [],
  fields: [],
} as unknown as ChallengeDetail;

test("ItemEditorDialog shows catalogue properties directly, including the book author", () => {
  const item = { id: "i1", title: "Torto Arado", catalogItem: { id: "c1", title: "Torto Arado", author: "Itamar", year: 2019 } } as unknown as ChallengeItem;
  const html = renderWithIntl(createElement(ItemEditorDialog, {
    item, challenge: catalogChallenge, members: [], library: { id: null, kind: "book" }, scope: "personal", recommendationsEnabled: false,
    onCancel: () => undefined, onSave: noop,
  }));
  assert.match(html, /value="Torto Arado"/);
  assert.doesNotMatch(html, /<details/, "properties use the shared editor without a disclosure");
  assert.match(html, /value="Itamar"/);
});

test("item editors never offer the built-in description, including legacy items", () => {
  for (const kind of ["film", "book", "custom"]) {
    const html = renderWithIntl(createElement(ItemEditorDialog, {
      item: { id: "legacy", title: "Existing item", description: "Legacy description" } as ChallengeItem,
      challenge: catalogChallenge, members: [], library: { id: null, kind }, scope: "personal", recommendationsEnabled: false,
      onCancel: () => undefined, onSave: noop,
    }));
    assert.doesNotMatch(html, /Descrição|Legacy description|<textarea/);
    assert.match(html, /Existing item/);
  }
});

test("challenge and catalogue editors use the same modal for an item without library properties", () => {
  const item = { id: "i", kind: "film", title: "Same item", rounds: [] };
  const challengeHtml = renderWithIntl(createElement(ItemEditorDialog, {
    item: { id: item.id, title: item.title }, challenge: catalogChallenge, members: [], library: null, scope: "personal", recommendationsEnabled: false,
    onCancel: () => undefined, onSave: noop,
  }));
  const catalogHtml = renderWithIntl(createElement(EditCatalogItemDialog, {
    item, libraries: [], scope: "personal",
    onCancel: () => undefined, onSaved: () => undefined,
  }));
  assert.equal(challengeHtml, catalogHtml.replace('maxLength="300"', 'maxLength="200"'));
});

test("checkpoint editing still offers the checkpoint description", () => {
  const html = renderWithIntl(createElement(ItemEditorDialog, {
    item: { id: "cp", title: "Week 1", description: "Checkpoint note" },
    challenge: { ...catalogChallenge, submissionMode: "daily" }, members: [], library: null, scope: "personal", recommendationsEnabled: false,
    onCancel: () => undefined, onSave: noop,
  }));
  assert.match(html, /Checkpoint note/);
  assert.match(html, /<textarea/);
});
