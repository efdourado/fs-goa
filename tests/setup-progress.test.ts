import assert from "node:assert/strict";
import { createElement } from "react";
import test from "node:test";

import type { PreflightReport } from "../app/goa/preflight-panel";
import { SETUP_STEPS, SetupSummary, setupState } from "../app/goa/setup-progress";
import { renderWithIntl } from "./helpers/intl";

const issue = (code: string, severity: "error" | "warning" = "error") => ({ code, severity, message: code });

test("o progresso da configuração agrupa os bloqueios por aba e aponta a primeira que falta", () => {
  const report: PreflightReport = {
    ready: false,
    errors: [issue("no_participants"), issue("no_items"), issue("metric_field_archived"), issue("codigo_novo")],
    warnings: [issue("no_metrics", "warning")],
  };
  const state = setupState(report, SETUP_STEPS);
  assert.deepEqual(state.errors, { overview: 1, items: 1, metrics: 1 }, "um código desconhecido conta no total, mas não aponta para aba nenhuma");
  assert.equal(state.errorCount, 4);
  assert.equal(state.todoCount, 4, "uma coisa a fazer por aba com problema, mais o que não aponta para aba nenhuma");
  assert.equal(state.firstTodo, "overview", "a primeira etapa, na ordem de trabalho");

  // Dois problemas na mesma aba são um serviço só, com um só motivo na tela.
  const sameTab = setupState({ ready: false, errors: [issue("no_items"), issue("no_way_to_register")], warnings: [] }, SETUP_STEPS);
  assert.equal(sameTab.errorCount, 2);
  assert.equal(sameTab.todoCount, 1);
  assert.deepEqual(sameTab.reasons.map((reason) => reason.code), ["no_items"]);

  const onlyLater = setupState({ ready: false, errors: [issue("no_items"), issue("no_checkpoints")], warnings: [] }, SETUP_STEPS);
  assert.equal(onlyLater.firstTodo, "items");
  const noStages = setupState({ ready: false, errors: [issue("no_checkpoints")], warnings: [] }, ["overview", "fields", "items"]);
  assert.equal(noStages.firstTodo, null, "uma aba que este desafio não tem nunca é a próxima");
});

test("sem bloqueios só há avisos: a configuração está pronta e o desafio pode começar", () => {
  const report: PreflightReport = { ready: true, errors: [], warnings: [issue("no_metrics", "warning")] };
  const state = setupState(report, SETUP_STEPS);
  assert.equal(state.errorCount, 0);
  assert.equal(state.firstTodo, null);
  const html = renderWithIntl(createElement(SetupSummary, { state, activeTab: "overview", onGo: () => undefined }));
  assert.match(html, /Comece o desafio pelo menu no topo/);
  assert.doesNotMatch(html, /<button/);
});

test("o resumo diz o que falta e leva à próxima coisa a fazer, sem oferecer ir para onde já se está", () => {
  const report: PreflightReport = { ready: false, errors: [issue("no_participants"), issue("no_items")], warnings: [] };
  const state = setupState(report, SETUP_STEPS);
  const elsewhere = renderWithIntl(createElement(SetupSummary, { state, activeTab: "fields", onGo: () => undefined }));
  assert.match(elsewhere, /Faltam 2 coisas para poder começar/);
  assert.doesNotMatch(elsewhere, /coisa para poder/, "no plural certo");
  assert.match(elsewhere, /O desafio não tem participantes/);
  assert.match(elsewhere, />Ir para Geral<\/button>/);
  const there = renderWithIntl(createElement(SetupSummary, { state, activeTab: "overview", onGo: () => undefined }));
  assert.doesNotMatch(there, /<button/);
});
