import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import { RuleSectionsView } from "../app/goa/rules";
import { DynamicEntryForm } from "../app/goa/screens/participant-challenge";
import { AppHeader, ChallengeStatusBadge, SchedulePeriodFields } from "../app/goa/ui";
import {
  entryUnavailableMessage,
  formatDateRange,
  inclusiveDayCount,
  isChallengeScheduled,
  itemStatusLabel,
  shiftDateKey,
} from "../app/goa/utils";

test("distingue desafio agendado do ciclo persistido ativo", () => {
  const now = new Date("2026-08-29T15:00:00Z");
  assert.equal(isChallengeScheduled("active", "2026-08-30", now), true);
  assert.equal(isChallengeScheduled("active", "2026-08-29", now), false);
  assert.equal(isChallengeScheduled("draft", "2026-08-30", now), false);
  assert.equal(isChallengeScheduled("closed", "2026-08-30", now), false);
  assert.equal(isChallengeScheduled("active", null, now), false);
});

test("apresenta período ou ausência de prazo sem datas fictícias", () => {
  assert.equal(formatDateRange(null, null), "Sem prazo");
  assert.match(formatDateRange("2026-08-01", "2026-08-31"), /01.*ago.*31.*ago/i);
});

test("deriva o término a partir do início e da duração", () => {
  // "Começa hoje, dura 90 dias" => 90 checkpoints, do dia 0 ao dia 89.
  assert.equal(shiftDateKey("2026-08-30", { days: 89 }), "2026-11-27");
  assert.equal(inclusiveDayCount("2026-08-30", "2026-11-27"), 90);
  // Passos em mês fecham o vão ("6 meses" = último dia antes do mesmo dia do mês).
  assert.equal(shiftDateKey("2026-01-15", { months: 6, days: -1 }), "2026-07-14");
  // Overflow de mês é aparado para o último dia real.
  assert.equal(shiftDateKey("2026-01-31", { months: 1 }), "2026-02-28");
  assert.equal(shiftDateKey("nao-e-data", { days: 5 }), "nao-e-data");
  assert.equal(inclusiveDayCount("2026-08-30", "2026-08-29"), null);
  assert.equal(inclusiveDayCount(null, "2026-08-30"), null);
});

test("campos de período oferecem atalhos de duração e refletem o span atual", () => {
  const withPeriod = renderToStaticMarkup(createElement(SchedulePeriodFields, {
    startsOn: "2026-08-30",
    endsOn: "2026-11-27",
    onStartsOn: () => undefined,
    onEndsOn: () => undefined,
  }));
  assert.match(withPeriod, /6 meses/);
  assert.match(withPeriod, /aria-pressed="true"[\s\S]*?>90 dias<\/button>/);
  assert.match(withPeriod, /90 dias · /);

  const empty = renderToStaticMarkup(createElement(SchedulePeriodFields, {
    startsOn: "",
    endsOn: "",
    onStartsOn: () => undefined,
    onEndsOn: () => undefined,
  }));
  assert.match(empty, /hoje, até você escolher/);
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
      {
        title: "Registro",
        description: "Preencher até 23h59.",
        topics: [{ title: "qualquer coisa", description: "vale tudo" }],
      },
    ],
  }));
  assert.match(rules, /Regras a serem seguidas/);
  assert.match(rules, /Meta diária/);
  assert.match(rules, /Registro/);
  assert.match(rules, /2\.1/, "tópico da regra 2 é numerado 2.1");
  assert.match(rules, /qualquer coisa/, "título do tópico é renderizado");
  assert.doesNotMatch(rules, /<details/);
});

test("formulário de registro esconde campos opcionais até a pessoa pedir", () => {
  const form = renderToStaticMarkup(createElement(DynamicEntryForm, {
    fields: [
      { id: "f1", key: "paginas", label: "Páginas lidas", type: "number", required: true },
      { id: "f2", key: "nota", label: "Nota do livro", type: "rating", required: false, config: { min: 0, max: 5, step: 0.5 } },
    ],
    item: null,
    canEdit: true,
    onSave: async () => undefined,
  }));
  assert.match(form, /Páginas lidas/);
  assert.doesNotMatch(form, /Nota do livro/, "campo opcional fica oculto por padrão");
  assert.match(form, /Mostrar campos opcionais \(1\)/);
});

test("header sinaliza logo, perfil e sair como clicáveis", () => {
  const header = renderToStaticMarkup(createElement(AppHeader, {
    user: { id: "user-1", name: "Pessoa Teste", username: "pessoa" },
    notifications: [],
    onHome: () => undefined,
    onAccount: () => undefined,
    onLogout: async () => undefined,
    onAcceptRequest: async () => undefined,
    onDeclineRequest: async () => undefined,
  }));
  const pointerCount = header.match(/cursor-pointer/g)?.length ?? 0;
  assert.ok(pointerCount >= 3, `esperava cursor clicável nos três controles; recebeu ${pointerCount}`);
  assert.match(header, /aria-label="Sua conta"/);
  assert.match(header, /aria-label="Novidades"/);
  assert.match(header, />Sair<\/button>/);
});

test("header lista convites de grupo pendentes no menu de novidades", () => {
  const header = renderToStaticMarkup(createElement(AppHeader, {
    user: { id: "user-1", name: "Pessoa Teste", username: "pessoa" },
    notifications: [
      { id: "req-1", groupId: "g1", groupName: "Clube do Sofá", role: "participant", invitedBy: "Ana", createdAt: "2026-08-30T12:00:00.000Z" },
    ],
    onHome: () => undefined,
    onAccount: () => undefined,
    onLogout: async () => undefined,
    onAcceptRequest: async () => undefined,
    onDeclineRequest: async () => undefined,
  }));
  assert.match(header, /aria-label="Novidades \(1\)"/);
});
