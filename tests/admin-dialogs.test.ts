import assert from "node:assert/strict";
import { createElement } from "react";
import test from "node:test";

import { ConfirmDialog } from "../app/goa/dialog";
import { CorrectionDialog, FieldEditorDialog, ItemEditorDialog } from "../app/goa/screens/admin";
import type { ChallengeDetail, ChallengeItem, Entry } from "../app/goa/types";
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

test("FieldEditorDialog shows the type-specific config for a rating field", () => {
  const html = renderWithIntl(createElement(FieldEditorDialog, {
    field: { key: "nota", label: "Nota", type: "rating", required: true, config: { min: 0, max: 5, step: 0.5 } },
    takenKeys: [],
    lockType: false,
    onCancel: () => undefined,
    onSave: noop,
  }));
  assert.match(html, /Editar campo/);
  assert.match(html, /value="Nota"/);
  // rating → min / max / step inputs from FieldConfigInputs
  assert.match(html, /Mínimo/);
  assert.match(html, /Máximo/);
  assert.match(html, /Intervalo/);
  assert.match(html, /Salvar alterações/);
});

test("FieldEditorDialog in add mode has no field and a create action", () => {
  const html = renderWithIntl(createElement(FieldEditorDialog, {
    takenKeys: ["nota"], lockType: false, onCancel: () => undefined, onSave: noop,
  }));
  assert.match(html, /Adicionar campo/);
  assert.doesNotMatch(html, /Salvar alterações/);
});

const catalogChallenge = {
  submissionMode: "item",
  status: "active",
  entryTypes: [],
  fields: [],
} as unknown as ChallengeDetail;

test("ItemEditorDialog folds the catalogue facts behind a details, author for books", () => {
  const item = { id: "i1", title: "Torto Arado", catalogItem: { id: "c1", title: "Torto Arado", author: "Itamar", year: 2019 } } as unknown as ChallengeItem;
  const html = renderWithIntl(createElement(ItemEditorDialog, {
    item, challenge: catalogChallenge, members: [], catalogKind: "book",
    onCancel: () => undefined, onSave: noop,
  }));
  assert.match(html, /value="Torto Arado"/);
  assert.match(html, /<details/, "catalogue facts sit in a details");
  assert.match(html, /Dados do acervo/);
  assert.match(html, /value="Itamar"/);
});

test("CorrectionDialog carries the mandatory reason field and the entry form", () => {
  const entry = { id: "e1", participantName: "Ana", values: {} } as unknown as Entry;
  const html = renderWithIntl(createElement(CorrectionDialog, {
    entry,
    challenge: { status: "active", participants: [], items: [], entryTypes: [], fields: [{ id: "nota", key: "nota", label: "Nota", type: "rating", required: true }] } as unknown as ChallengeDetail,
    item: null,
    fields: [{ id: "nota", key: "nota", label: "Nota", type: "rating", required: true }],
    onClose: () => undefined,
    onPatch: noop,
    onDelete: noop,
  }));
  assert.match(html, /Correção administrativa/);
  assert.match(html, /Motivo/);
  assert.match(html, /Excluir registro|Enviar.*lixeira|deleteEntry/i);
});
