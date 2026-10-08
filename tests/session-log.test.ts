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

test("o registro de um treino: um dia vazio começa escolhendo os itens; nada de 'repetir', nada de 'por item'", () => {
  const spec = sessionSpecOf(challenge)!;
  const html = renderWithIntl(createElement(SessionLog, {
    challenge, spec, entries, userId: "me", canEdit: true, onSave: async () => undefined, onDelete: async () => undefined,
  }));
  assert.match(html, /Registrar Treino/, "o título usa o nome que o criador deu");
  const form = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
  assert.match(form, /Toque para adicionar/, "o treino de hoje começa escolhendo o que fazer, mesmo com treinos anteriores");
  assert.ok(form.indexOf("Supino") < form.indexOf("Agachamento"), "os mais usados primeiro");
  assert.doesNotMatch(form, /Repetir o último/, "ninguém repete um treino inteiro");
  assert.doesNotMatch(form, /Renomear/, "sem permissão, não há como renomear o check-in");
  assert.match(html, /<strong[^>]*>2<\/strong> dias com registro desde/, "só os seus dois treinos contam");
  assert.match(html, /semanas? seguidas?/, "um treino conta semanas seguidas, não dias");
  assert.doesNotMatch(html, /100(?!%)/, "o treino de outra pessoa não entra no seu log");
  assert.doesNotMatch(html, /Melhor ·|desde o primeiro|check-ins<\/span>/, "o 'por item' saiu: isso é dos Resultados");
});

test("sem treino para repetir, a bandeja aparece; quem pode criar itens ganha o Novo item", () => {
  const spec = sessionSpecOf(challenge)!;
  const html = renderWithIntl(createElement(SessionLog, {
    challenge, spec, entries: [], userId: "me", canEdit: true, onSave: async () => undefined, onAddItem: async () => "new",
  }));
  assert.match(html, /Toque para adicionar/);
  assert.match(html, /Novo item/);
});

test("o treino de hoje já registrado abre para editar: uma linha por item, com a última vez, a diferença e o recorde", () => {
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
  assert.doesNotMatch(form, /type="date"/, "a data está na faixa de dias, não no formulário");
  assert.match(form, /data-item="bench"/, "o supino de hoje é uma linha");
  assert.match(form, /title="Repetir"[^>]*>Da última vez: 57[,.]5 · 8/, "a última vez à mão: tocar nela repete os números");
  assert.match(form, /\+2,5 vs\. última/, "a carga subiu 2,5 desde o último treino");
  assert.match(form, /Recorde de Carga \(kg\) · antes 57[,.]5/);
  assert.match(form, /aria-label="Tirar Supino"/, "cada linha sai com um toque");
  assert.match(form, />＋ Adicionar</, "mais itens esperam atrás de '+ Adicionar'");
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

test("a bandeja mostra os oito mais usados e guarda o resto em Mostrar mais; quem administra pode renomear o check-in", () => {
  const many = {
    ...challenge,
    items: Array.from({ length: 11 }, (_, index) => ({ id: `i${index}`, title: `Exercício ${index + 1}`, position: index })),
  } as unknown as ChallengeDetail;
  const spec = sessionSpecOf(many)!;
  const html = renderWithIntl(createElement(SessionLog, {
    challenge: many, spec, entries: [], userId: "me", canEdit: true,
    onSave: async () => undefined, onDelete: async () => undefined, onRename: async () => undefined,
  }));
  const tray = html.slice(html.indexOf('role="group" aria-label="Item"'), html.indexOf("Mostrar mais"));
  assert.equal((tray.match(/aria-pressed="false"/g) ?? []).length, 8, "oito itens à mão");
  assert.match(html, /Mostrar mais \(3\)/);
  assert.match(html, /Renomear/);
  assert.doesNotMatch(html, /Remover Exercício/, "sem o botão de remover no cartão — tocar de novo na bandeja tira o item");
});
