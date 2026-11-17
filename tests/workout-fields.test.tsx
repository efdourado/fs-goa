import assert from "node:assert/strict";
import { createElement } from "react";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { AdminScreen } from "../app/goa/screens/admin";
import type { ChallengeDetail, EntryTypeView } from "../app/goa/types";
import { renderWithIntl } from "./helpers/intl";

function editor(types: Partial<EntryTypeView>[]) {
  const challenge = {
    id: "workout", title: "Workout", status: "active", scope: "personal", submissionMode: "item",
    libraries: [{ id: null, kind: "exercise" }], fields: [], entryTypes: types,
    items: [], checkpoints: [], metrics: [], participants: [],
  } as unknown as ChallengeDetail;
  const props = { challenge, entries: [], tab: "fields", duplicateTargets: [], onBack: () => undefined, onTab: () => undefined } as unknown as Parameters<typeof AdminScreen>[0];
  return new JSDOM(renderWithIntl(createElement(AdminScreen, props)));
}

test("Entry fields shows all workout and day fields together without a redundant response heading", () => {
  const dom = editor([
    { id: "day", name: "Treino", purpose: "checkin", fields: [{ id: "note", key: "note", label: "Como foi?", type: "text", required: false }] },
    { id: "exercise", name: "Desempenho", semanticKey: "desempenho", purpose: "progress", parentTypeId: "day", isPrimary: true,
      fields: [{ id: "weight", key: "weight", label: "Carga", type: "number", required: true }, { id: "reps", key: "reps", label: "Repetições — Série 1", type: "number", required: true }] },
  ]);
  try {
    const doc = dom.window.document;
    assert.match(doc.body.textContent!, /Carga/);
    assert.match(doc.body.textContent!, /Repetições — Série 1/);
    assert.match(doc.body.textContent!, /Como foi\?/);
    assert.equal(doc.querySelector('h2'), null);
    assert.equal(doc.querySelector('button[aria-pressed]'), null, "no response group tabs");
    assert.doesNotMatch(doc.body.textContent!, /Treino|Desempenho|Detalhes do check-in|Configurações da resposta/);
    assert.equal(doc.querySelector('button[aria-label="Ajustes do registro"]'), null);
    assert.equal(doc.querySelector('button[role="switch"][aria-label="Progresso"]'), null, "workout performance is not a completion goal");
  } finally { dom.window.close(); }
});

test("primary reading progress remains an editable field rather than a supplementary goal", () => {
  const dom = editor([
    { id: "reading", name: "Reading", purpose: "progress", isPrimary: true,
      fields: [{ id: "pages", key: "pages", label: "Páginas lidas", type: "number", required: true, config: { count: { goal: { from: "page_count" }, entry: "amount", showDates: true } } }] },
    { id: "done", name: "Terminei", purpose: "completion", fields: [{ id: "comment", key: "comment", label: "Comentário", type: "text", required: false }] },
  ]);
  try {
    assert.match(dom.window.document.body.textContent!, /Páginas lidas/);
    assert.equal(dom.window.document.querySelector('button[role="switch"][aria-label="Progresso"]'), null);
  } finally { dom.window.close(); }
});
