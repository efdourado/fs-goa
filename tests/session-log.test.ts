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

test("o registro de um treino: bandeja de itens para tocar, histórico só seu e o melhor de cada campo por exercício", () => {
  const spec = sessionSpecOf(challenge)!;
  const html = renderWithIntl(createElement(SessionLog, {
    challenge, spec, entries, userId: "me", canEdit: true, onSave: async () => undefined, onDelete: async () => undefined,
  }));
  assert.match(html, /Registrar Treino/, "o título usa o nome que o criador deu");
  assert.match(html, /Toque para adicionar/);
  const form = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
  // Cada item é um botão da bandeja, os mais usados primeiro; nenhum ainda neste treino.
  assert.ok(form.indexOf("Supino") < form.indexOf("Agachamento"), "o supino, usado duas vezes, vem antes");
  assert.ok((form.match(/aria-pressed="false"/g) ?? []).length >= 2);
  assert.match(form, /Escolha acima o que entrou neste Treino/, "sem cartões, uma dica em vez de um formulário vazio");
  assert.doesNotMatch(form, /Novo item/, "sem permissão, não há como criar item");
  assert.match(html, /<strong[^>]*>2<\/strong> de \d+ dias com registro/, "só os seus dois treinos contam na faixa de dias");
  assert.doesNotMatch(html, /<h2[^>]*>Seus check-ins<\/h2>/, "o histórico repetido embaixo da faixa saiu");
  assert.doesNotMatch(html, /100(?!%)/, "o treino de outra pessoa não entra no seu histórico nem nos recordes");
  assert.match(html, /Melhor · Carga \(kg\)<\/dt><dd[^>]*>57,5<\/dd>/, "o recorde do supino sai do histórico, sem ninguém digitá-lo");
  assert.match(html, /Supino<\/strong><span[^>]*>2 check-ins<\/span>/, "o supino apareceu nos dois treinos");
  assert.doesNotMatch(html, /· último/, "o número grande fala por si, sem rótulo em cima");
  assert.match(html, /\+2,5 desde o primeiro/, "e diz quanto mudou desde o primeiro");
});

test("quem pode criar itens ganha o botão Novo item na bandeja", () => {
  const spec = sessionSpecOf(challenge)!;
  const html = renderWithIntl(createElement(SessionLog, {
    challenge, spec, entries, userId: "me", canEdit: true, onSave: async () => undefined, onAddItem: async () => "new",
  }));
  assert.match(html, /Novo item/);
});

test("o treino de hoje já registrado abre para editar, com a última vez, a diferença e o recorde", () => {
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
  const form = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
  assert.match(form, /Editando Treino/);
  assert.match(form, /data-item="bench"/, "o supino de hoje vira um cartão");
  assert.match(form, /\+2,5 vs\. última/, "a carga subiu 2,5 desde o último treino");
  assert.match(form, /Recorde de Carga \(kg\) · antes 57[,.]5/);
  assert.match(form, /aria-pressed="true"[^>]*>(?:(?!<\/button>)[\s\S])*Supino/, "o supino aparece marcado na bandeja");
  assert.match(form, />Excluir</, "um treino salvo pode ser excluído dali mesmo");
});

test("sem itens no desafio, o log avisa em vez de mostrar um formulário vazio", () => {
  const spec = sessionSpecOf(challenge)!;
  const html = renderWithIntl(createElement(SessionLog, {
    challenge: { ...challenge, items: [] } as ChallengeDetail, spec, entries: [], userId: "me", canEdit: true, onSave: async () => undefined,
  }));
  assert.match(html, /ainda não tem itens/);
  assert.doesNotMatch(html, /Registrar Treino/);
});
