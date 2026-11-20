import assert from "node:assert/strict";
import { createElement } from "react";
import test from "node:test";

import { ChallengeStatePanel } from "../app/goa/screens/challenge-actions";
import { SETUP_STEPS, SetupBlockerList, setupBlockersByTab } from "../app/goa/setup-progress";
import type { ChallengeDetail } from "../app/goa/types";
import type { PreflightIssue, PreflightReport } from "../lib/goa/challenges/preflight";
import { renderWithIntl } from "./helpers/intl";

const issue = (code: string, severity: PreflightIssue["severity"] = "error"): PreflightIssue => ({ code, severity, message: code });

test("os bloqueios aparecem apenas nas abas em que podem ser corrigidos", () => {
  const participants = issue("no_participants");
  const items = issue("no_items");
  const checkpoints = issue("no_checkpoints");
  const metrics = issue("metric_field_archived");
  const unknown = issue("codigo_novo");
  const report: PreflightReport = {
    ready: false,
    errors: [participants, items, checkpoints, metrics, unknown],
    warnings: [issue("no_metrics", "warning")],
  };
  const blockers = setupBlockersByTab(report, SETUP_STEPS);
  assert.deepEqual(blockers, { overview: [participants, unknown], checkpoints: [items, checkpoints], results: [metrics] });
  assert.deepEqual(setupBlockersByTab(report, ["overview", "results"]), { overview: [participants, items, checkpoints, unknown], results: [metrics] });
  const itemsHtml = renderWithIntl(createElement(SetupBlockerList, { issues: blockers.checkpoints }));
  assert.match(itemsHtml, /Faltam 2 coisas para poder começar/);
  assert.doesNotMatch(itemsHtml, /O desafio não tem participantes|<button/);
});

test("Ativação do desafio mostra o interruptor no cabeçalho e o bloqueio de Geral logo abaixo", () => {
  const blockers = setupBlockersByTab({ ready: false, errors: [issue("no_participants"), issue("choice_without_options")], warnings: [] }, SETUP_STEPS);
  const props = {
    challenge: { kind: "round", status: "draft" } as ChallengeDetail,
    canActivate: false,
    onTransition: async () => undefined,
  };
  const html = renderWithIntl(createElement(ChallengeStatePanel, { ...props, blockers: blockers.overview }));
  assert.match(html, /Ativação do desafio.*Ative o desafio para liberar os registros\. Só administradores veem o rascunho\..*role="switch"[^>]*aria-checked="false"[^>]* disabled=""[^>]*>.*Falta 1 coisa para poder começar.*O desafio não tem participantes/);
  assert.doesNotMatch(html, /campo de escolha|Ir para Geral/);

  const ready = setupBlockersByTab({ ready: true, errors: [], warnings: [issue("no_metrics", "warning")] }, SETUP_STEPS);
  const readyHtml = renderWithIntl(createElement(ChallengeStatePanel, { ...props, canActivate: true, blockers: ready.overview }));
  assert.match(readyHtml, /Ative o desafio para liberar os registros\..*role="switch"[^>]*aria-checked="false"/);
  assert.doesNotMatch(readyHtml, /role="switch"[^>]* disabled=""/);
  assert.doesNotMatch(readyHtml, /para poder começar|<li>/);
});
