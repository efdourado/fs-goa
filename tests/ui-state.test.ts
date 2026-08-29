import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import { RuleSectionsView } from "../app/goa/rules";
import { AppHeader, ChallengeStatusBadge } from "../app/goa/ui";
import { entryUnavailableMessage, isChallengeScheduled, itemStatusLabel } from "../app/goa/utils";

test("distingue desafio agendado do ciclo persistido ativo", () => {
  const now = new Date("2026-08-29T15:00:00Z");
  assert.equal(isChallengeScheduled("active", "2026-08-30", now), true);
  assert.equal(isChallengeScheduled("active", "2026-08-29", now), false);
  assert.equal(isChallengeScheduled("draft", "2026-08-30", now), false);
  assert.equal(isChallengeScheduled("closed", "2026-08-30", now), false);
});

test("explica por que um registro está indisponível sem chamar futuro de encerrado", () => {
  const scheduled = entryUnavailableMessage({
    challengeStatus: "active",
    isParticipant: true,
    itemStatus: "scheduled",
    opensAt: "2099-01-01T03:00:00.000Z",
  });
  assert.match(scheduled ?? "", /ainda não começou/i);
  assert.doesNotMatch(scheduled ?? "", /desafio.*encerrado/i);
  assert.match(entryUnavailableMessage({ challengeStatus: "draft", isParticipant: true }) ?? "", /rascunho/i);
  assert.match(entryUnavailableMessage({ challengeStatus: "active", isParticipant: false }) ?? "", /não está entre/i);
  assert.match(entryUnavailableMessage({ challengeStatus: "closed", isParticipant: true }) ?? "", /encerrado/i);
  assert.equal(entryUnavailableMessage({ challengeStatus: "active", isParticipant: true, itemStatus: "open" }), null);
});

test("traduz os estados dos checkpoints", () => {
  assert.equal(itemStatusLabel("scheduled"), "Programado");
  assert.equal(itemStatusLabel("open"), "Disponível");
  assert.equal(itemStatusLabel("past_due"), "Prazo encerrado");
  assert.equal(itemStatusLabel("closed"), "Encerrado");
});

test("renderiza estado agendado e regras tituladas em destaque", () => {
  const badge = renderToStaticMarkup(createElement(ChallengeStatusBadge, {
    status: "active",
    startsOn: "2099-01-01",
  }));
  // Text-less status dot: the label lives in the accessible name + tooltip.
  assert.match(badge, /aria-label="Situação: Agendado"/);
  assert.match(badge, /title="Agendado"/);
  assert.match(badge, /rounded-full/);

  const activeBadge = renderToStaticMarkup(createElement(ChallengeStatusBadge, { status: "active" }));
  assert.match(activeBadge, /aria-label="Situação: Ativo"/);

  const rules = renderToStaticMarkup(createElement(RuleSectionsView, {
    rules: [
      { title: "Meta diária", description: "Ler vinte páginas." },
      { title: "Registro", description: "Preencher até 23h59." },
    ],
  }));
  assert.match(rules, /Regras do desafio/);
  assert.match(rules, /Meta diária/);
  assert.match(rules, /Registro/);
  assert.doesNotMatch(rules, /<details/);
});

test("header sinaliza logo, perfil e sair como clicáveis", () => {
  const header = renderToStaticMarkup(createElement(AppHeader, {
    user: { id: "user-1", name: "Pessoa Teste", username: "pessoa" },
    onHome: () => undefined,
    onAccount: () => undefined,
    onLogout: async () => undefined,
  }));
  const pointerCount = header.match(/cursor-pointer/g)?.length ?? 0;
  assert.ok(pointerCount >= 3, `esperava cursor clicável nos três controles; recebeu ${pointerCount}`);
  assert.match(header, /aria-label="Sua conta"/);
  assert.match(header, />Sair<\/button>/);
});
