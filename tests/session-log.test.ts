import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";

import { SessionLog, sessionSpecOf } from "../app/goa/session-log";
import type { ChallengeDetail, Entry } from "../app/goa/types";
import { dateKeyInSaoPaulo } from "../app/goa/utils";
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

test("o dia de um treino: um botão claro para registrar hoje; sem 'repetir', sem 'por item', só o seu histórico", () => {
  const spec = sessionSpecOf(challenge)!;
  const html = renderWithIntl(createElement(SessionLog, {
    challenge, spec, entries, userId: "me", canEdit: true, onSave: async () => undefined, onDelete: async () => undefined,
  }));
  assert.match(html, /＋ Registrar o treino de hoje/, "o caminho do dia, num botão só");
  assert.doesNotMatch(html, /Repetir o último/);
  assert.match(html, /<strong[^>]*>2<\/strong> dias com registro desde/, "só os seus dois treinos contam");
  assert.match(html, /semanas? seguidas?/, "um treino conta semanas seguidas, não dias");
  assert.doesNotMatch(html, /100(?!%)/, "o treino de outra pessoa não entra no seu log");
  assert.doesNotMatch(html, /Melhor ·|desde o primeiro/, "o 'por item' é dos Resultados");
  assert.doesNotMatch(html, /Salvar treino/, "não há botão de salvar: o registro se salva sozinho, na folha");
});

test("o treino de hoje já registrado aparece resumido, com Continuar e um novo treino no mesmo dia", () => {
  const spec = sessionSpecOf(challenge)!;
  const today = dateKeyInSaoPaulo(new Date());
  const withToday = [
    ...entries,
    entry({ id: "w3", entryTypeId: "visit", occurredOn: today }),
    entry({ id: "w3-bench", entryTypeId: "record", parentEntryId: "w3", itemId: "bench", occurredOn: today, values: { carga: 60, reps: 8 } }),
  ];
  const html = renderWithIntl(createElement(SessionLog, {
    challenge, spec, entries: withToday, userId: "me", canEdit: true, onSave: async () => undefined, onDelete: async () => undefined,
  }));
  assert.match(html, /Treino 1 · 1 item/);
  assert.match(html, /Supino<\/span><span[^>]*>60 · 8<\/span>/, "cada exercício numa linha, com os números");
  assert.match(html, />Editar</);
  assert.match(html, /＋ Novo treino/, "outro treino no mesmo dia");
});

test("quem não pode registrar vê o resumo, sem o botão", () => {
  const spec = sessionSpecOf(challenge)!;
  const html = renderWithIntl(createElement(SessionLog, {
    challenge, spec, entries, userId: "me", canEdit: false, unavailableMessage: "Fechado.", onSave: async () => undefined,
  }));
  assert.doesNotMatch(html, /Registrar o treino/);
  assert.match(html, /Fechado\./);
});

test("sem itens no desafio, o log avisa em vez de mostrar um formulário vazio", () => {
  const spec = sessionSpecOf(challenge)!;
  const html = renderWithIntl(createElement(SessionLog, {
    challenge: { ...challenge, items: [] } as ChallengeDetail, spec, entries: [], userId: "me", canEdit: true, onSave: async () => undefined,
  }));
  assert.match(html, /ainda não tem itens/);
  assert.doesNotMatch(html, /Registrar Treino/);
});
