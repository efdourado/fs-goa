import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";

import {
  amountFromPosition,
  checkAmount,
  counterField,
  dayList,
  logRange,
  monthCells,
  monthsIn,
  overTotal,
  pace,
  streak,
  sumBefore,
} from "../app/goa/checkin-days";
import { CheckinLog, type LogRecord } from "../app/goa/checkin-log";
import type { ChallengeField, Entry } from "../app/goa/types";
import { renderWithIntl } from "./helpers/intl";

const pages: ChallengeField = { id: "p", key: "paginas", label: "Páginas lidas", type: "number", required: true, config: { min: 0, step: 1 } };
const note: ChallengeField = { id: "n", key: "nota_dia", label: "Como foi?", type: "text", required: false, config: { multiline: true } };

test("a faixa de um livro vai da abertura ao prazo, dentro do período do desafio", () => {
  assert.deepEqual(
    logRange({ today: "2026-09-28", startsOn: "2026-09-01", endsOn: "2026-11-30", opensOn: "2026-09-14", dueOn: "2026-10-07" }),
    { from: "2026-09-14", to: "2026-10-07" },
  );
  // sem janela própria, o período inteiro
  assert.deepEqual(logRange({ today: "2026-09-28", startsOn: "2026-09-01", endsOn: "2026-11-30" }), { from: "2026-09-01", to: "2026-11-30" });
});

test("um livro com prazo vencido ainda deixa hoje ao alcance, sem passar do fim do desafio", () => {
  assert.deepEqual(
    logRange({ today: "2026-09-28", startsOn: "2026-09-01", endsOn: "2026-11-30", opensOn: "2026-09-01", dueOn: "2026-09-20" }),
    { from: "2026-09-01", to: "2026-09-28" },
  );
});

test("sem datas, mostra as últimas cinco semanas e recua até o primeiro registro", () => {
  assert.deepEqual(logRange({ today: "2026-09-28" }), { from: "2026-08-25", to: "2026-09-28" });
  assert.equal(dayList("2026-08-25", "2026-09-28").length, 35);
  assert.deepEqual(logRange({ today: "2026-09-28", loggedDays: ["2026-09-20", "2026-07-01"] }), { from: "2026-07-01", to: "2026-09-28" });
});

test("a sequência conta os dias seguidos até hoje, ou até ontem enquanto hoje está em aberto", () => {
  const logged = new Set(["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]);
  assert.equal(streak(logged, "2026-09-28"), 4);
  assert.equal(streak(new Set([...logged, "2026-09-28"]), "2026-09-28"), 5);
  assert.equal(streak(new Set(["2026-09-25"]), "2026-09-28"), 0);
});

test("'parei na página' vira as páginas do dia, inclusive ao corrigir um dia passado", () => {
  const values = new Map([["2026-09-14", 22], ["2026-09-15", 18], ["2026-09-17", 25]]);
  // hoje: começou na p. 65, parou na 90
  assert.equal(sumBefore(values, "2026-09-28"), 65);
  assert.equal(amountFromPosition(90, sumBefore(values, "2026-09-28")), 25);
  // dia 16, que ficou sem registro: começou na 40 (o dia 17 fica depois)
  assert.equal(sumBefore(values, "2026-09-16"), 40);
  assert.equal(amountFromPosition(52, sumBefore(values, "2026-09-16")), 12);
  // reescrever o dia 15 conta a partir do fim do dia 14, não do próprio 15
  assert.equal(amountFromPosition(50, sumBefore(values, "2026-09-15")), 28);
});

test("uma página antes de onde o dia começou é o erro nomeado", () => {
  assert.deepEqual(checkAmount({ amount: -3, mode: "position", before: 40, field: pages }), { code: "belowStart", before: 40 });
  assert.deepEqual(checkAmount({ amount: 0, mode: "amount", before: 40, field: pages }), { code: "notPositive" });
  assert.deepEqual(checkAmount({ amount: 2.5, mode: "amount", before: 0, field: pages }), { code: "notWhole" });
  assert.deepEqual(checkAmount({ amount: null, mode: "amount", before: 0, field: pages }), { code: "empty" });
  assert.equal(checkAmount({ amount: 12, mode: "amount", before: 0, field: pages }), null);
  assert.deepEqual(checkAmount({ amount: 12, mode: "amount", before: 0, field: { ...pages, config: { min: 0, max: 10, step: 1 } } }), { code: "aboveMax", max: 10 });
  const km: ChallengeField = { id: "k", key: "km", label: "km", type: "number", required: true, config: { min: 0, step: 0.5 } };
  assert.equal(checkAmount({ amount: 5.5, mode: "amount", before: 0, field: km }), null);
  assert.deepEqual(checkAmount({ amount: 5.2, mode: "amount", before: 0, field: km }), { code: "offStep", step: 0.5 });
});

test("passar do total do livro é só um aviso, contando a troca do próprio dia", () => {
  const values = new Map([["2026-09-14", 300], ["2026-09-15", 40]]);
  assert.equal(overTotal(values, "2026-09-16", 12, 352), false);
  assert.equal(overTotal(values, "2026-09-16", 13, 352), true);
  // reescrever o dia 15 de 40 para 52 fecha exatamente em 352
  assert.equal(overTotal(values, "2026-09-15", 52, 352), false);
  assert.equal(overTotal(values, "2026-09-16", 999, null), false);
});

test("o ritmo é conta: onde a leitura uniforme estaria ao fim de hoje, e quanto falta por dia", () => {
  // 24 dias de 14/9 a 7/10; hoje é o 15º
  const result = pace({ total: 352, from: "2026-09-14", to: "2026-10-07", today: "2026-09-28", done: 218, loggedToday: false });
  assert.deepEqual(result, { expected: 220, ahead: -2, left: 134, perDay: 14 });
  assert.equal(pace({ total: 352, from: "2026-09-14", to: null, today: "2026-09-28", done: 0, loggedToday: false }), null);
  assert.equal(pace({ total: null, from: "2026-09-14", to: "2026-10-07", today: "2026-09-28", done: 0, loggedToday: false }), null);
  // depois do prazo, o esperado é o livro todo e não há "por dia"
  assert.deepEqual(pace({ total: 100, from: "2026-09-01", to: "2026-09-10", today: "2026-09-28", done: 60, loggedToday: false }), { expected: 100, ahead: -40, left: 40, perDay: null });
});

test("só um único campo numérico não negativo conta, com no máximo notas de texto opcionais ao lado", () => {
  assert.equal(counterField([pages])?.id, "p");
  assert.equal(counterField([pages, note])?.id, "p");
  assert.equal(counterField([note]), null);
  assert.equal(counterField([pages, { ...pages, id: "q", key: "minutos" }]), null);
  assert.equal(counterField([{ ...pages, config: { min: -10 } }]), null);
  assert.equal(counterField([pages, { ...note, required: true }]), null);
  assert.equal(counterField([pages, { id: "r", key: "nota", label: "Nota", type: "rating", required: false }]), null);
});

test("o calendário do mês começa no domingo e cobre os meses tocados", () => {
  const cells = monthCells("2026-09");
  assert.equal(cells.filter((cell) => cell === null).length, 2); // 1/9/2026 é terça
  assert.equal(cells.at(-1), "2026-09-30");
  assert.deepEqual(monthsIn("2026-11-20", "2027-01-05"), ["2026-11", "2026-12", "2027-01"]);
});

const book = (day: string, pagesRead: number): [string, LogRecord] => [day, { entry: { id: `e-${day}`, userId: "me", occurredOn: day, values: { p: pagesRead } } as Entry, value: pagesRead }];

test("o log de um livro mostra a página, o ritmo e um dia por chip, com hoje ainda em aberto", () => {
  const records = new Map([book("2026-09-14", 22), book("2026-09-15", 18), book("2026-09-17", 25)]);
  const html = renderWithIntl(createElement(CheckinLog, {
    from: "2026-09-14", to: "2026-10-07", today: "2026-09-28", deadline: "2026-10-07",
    records, selectedDay: "2026-09-28", onSelectDay: () => undefined, canEdit: true,
    counter: { field: pages, notes: [], total: 352, paceFrom: "2026-09-14", paceTo: "2026-10-07", onSave: async () => undefined },
  }));
  assert.match(html, /p\. 65/);
  assert.match(html, /de 352/);
  assert.match(html, /ritmo · p\. 220/);
  assert.match(html, /155 págs\. atrás do ritmo/);
  assert.match(html, /Faltam <strong[^>]*>287<\/strong> páginas/);
  assert.match(html, /aria-label="Hoje, 28 de setembro, sem registro"/);
  assert.match(html, /aria-label="[^"]*16 de setembro, sem registro"/);
  assert.match(html, /Parei na página/);
  // dias futuros ficam travados
  assert.match(html, /disabled=""[^>]*data-day="2026-10-01"|data-day="2026-10-01"[^>]*disabled=""/);
});

test("um hábito sem número marca o dia com ✓ e deixa o formulário de sempre embaixo", () => {
  const records = new Map([["2026-09-27", { entry: { id: "h1", userId: "me", occurredOn: "2026-09-27", values: {} } as Entry, value: null }]]);
  const html = renderWithIntl(createElement(CheckinLog, {
    from: "2026-08-25", to: "2026-09-28", today: "2026-09-28",
    records, selectedDay: "2026-09-28", onSelectDay: () => undefined, canEdit: true,
  }, createElement("p", null, "formulário do dia")));
  assert.match(html, /27 de setembro, registrado/);
  assert.match(html, /formulário do dia/);
  assert.doesNotMatch(html, /ritmo/);
});
