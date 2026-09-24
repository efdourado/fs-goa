import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";

import { SessionLog, sessionSpecOf } from "../app/goa/session-log";
import type { ChallengeDetail, Entry } from "../app/goa/types";
import { renderWithIntl } from "./helpers/intl";

const visitType = { id: "visit", name: "Treino", semanticKey: "sessao", parentTypeId: null, fields: [{ id: "note", key: "nota", label: "Como foi?", type: "text", required: false }] };
const recordType = {
  id: "record", name: "Desempenho", semanticKey: "desempenho", parentTypeId: "visit",
  fields: [
    { id: "carga", key: "carga", label: "Carga (kg)", type: "number", required: true },
    { id: "reps", key: "reps", label: "Repetições", type: "number", required: true },
  ],
};
const challenge = {
  id: "c", status: "active", isParticipant: true, libraries: [],
  entryTypes: [visitType, recordType],
  items: [{ id: "bench", title: "Supino", position: 0 }, { id: "squat", title: "Agachamento", position: 1 }],
} as unknown as ChallengeDetail;

const entry = (partial: Partial<Entry> & { id: string }): Entry => ({ userId: "me", values: {}, ...partial });
const entries: Entry[] = [
  entry({ id: "w1", entryTypeId: "visit", occurredOn: "2026-09-19", values: { note: "" } }),
  entry({ id: "w1-bench", entryTypeId: "record", parentEntryId: "w1", itemId: "bench", occurredOn: "2026-09-19", values: { carga: 55, reps: 6 } }),
  entry({ id: "w2", entryTypeId: "visit", occurredOn: "2026-09-22" }),
  entry({ id: "w2-bench", entryTypeId: "record", parentEntryId: "w2", itemId: "bench", occurredOn: "2026-09-22", values: { carga: 57.5, reps: 8 } }),
  entry({ id: "w2-squat", entryTypeId: "record", parentEntryId: "w2", itemId: "squat", occurredOn: "2026-09-22", values: { carga: 70, reps: 8 } }),
  // someone else's workout never shows in your log
  entry({ id: "x1", userId: "other", entryTypeId: "visit", occurredOn: "2026-09-21" }),
  entry({ id: "x1-bench", userId: "other", entryTypeId: "record", parentEntryId: "x1", itemId: "bench", occurredOn: "2026-09-21", values: { carga: 100, reps: 1 } }),
];

test("um check-in que guarda registros por item é reconhecido pelos tipos; um desafio comum não é", () => {
  const spec = sessionSpecOf(challenge)!;
  assert.equal(spec.visit.id, "visit");
  assert.equal(spec.record.id, "record");
  assert.equal(sessionSpecOf({ entryTypes: [{ ...visitType, parentTypeId: null }] } as unknown as ChallengeDetail), null);
});

test("o registro de um treino: formulário com uma linha por item, histórico só seu e o melhor de cada campo por exercício", () => {
  const spec = sessionSpecOf(challenge)!;
  const html = renderWithIntl(createElement(SessionLog, {
    challenge, spec, entries, userId: "me", canEdit: true, onSave: async () => undefined, onDelete: async () => undefined,
  }));
  assert.match(html, /Registrar Treino/, "o título usa o nome que o criador deu");
  assert.match(html, /Carga \(kg\)/);
  assert.match(html, /Repetições/);
  assert.match(html, /Adicionar outro/);
  // Cada exercício é um cartão com os próprios rótulos — sem um cabeçalho de colunas repetindo o que está em cada linha.
  const form = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
  assert.match(form, /<ol/, "os exercícios formam uma lista de cartões");
  assert.equal((form.match(/Carga \(kg\)/g) ?? []).length, 1, "o rótulo de cada campo aparece uma vez por exercício");
  assert.doesNotMatch(form, /aria-hidden="true"[^>]*>\s*<span[^>]*>Exercícios</, "sem linha de cabeçalho de colunas");
  assert.match(html, /2 check-ins/, "só os seus dois treinos contam");
  assert.doesNotMatch(html, /100/, "o treino de outra pessoa não entra no seu histórico nem nos recordes");
  assert.match(html, /Melhor Carga \(kg\): 57,5|Melhor Carga \(kg\): 57\.5/, "o recorde do supino sai do histórico, sem ninguém digitá-lo");
  assert.match(html, /em 2 check-ins/, "o supino apareceu nos dois treinos");
});

test("sem itens no desafio, o log avisa em vez de mostrar um formulário vazio", () => {
  const spec = sessionSpecOf(challenge)!;
  const html = renderWithIntl(createElement(SessionLog, {
    challenge: { ...challenge, items: [] } as ChallengeDetail, spec, entries: [], userId: "me", canEdit: true, onSave: async () => undefined,
  }));
  assert.match(html, /ainda não tem itens/);
  assert.doesNotMatch(html, /Registrar Treino/);
});
