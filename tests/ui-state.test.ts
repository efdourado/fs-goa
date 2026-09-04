import assert from "node:assert/strict";
import { createElement } from "react";
import test from "node:test";

import { RuleSectionsView } from "../app/goa/rules";
import { DynamicEntryForm, ResultView } from "../app/goa/screens/participant-challenge";
import type { ChallengeDetail, ChallengeField } from "../app/goa/types";
import { AppHeader, ChallengeStatusBadge, SchedulePeriodFields } from "../app/goa/ui";
import {
  findMissingRequiredField,
  inclusiveDayCount,
  isChallengeScheduled,
  isEmptySaveADelete,
  isLivingList,
  shiftDateKey,
} from "../app/goa/utils";
import { ptFormat, renderWithIntl } from "./helpers/intl";

test("desafio agendado existe só no diário com início futuro", () => {
  const now = new Date("2026-08-29T15:00:00Z");
  assert.equal(isChallengeScheduled("active", "2026-08-30", "daily", now), true);
  assert.equal(isChallengeScheduled("active", "2026-08-29", "daily", now), false);
  assert.equal(isChallengeScheduled("draft", "2026-08-30", "daily", now), false);
  assert.equal(isChallengeScheduled("closed", "2026-08-30", "daily", now), false);
  assert.equal(isChallengeScheduled("active", null, "daily", now), false);
  // Cine (item) com início futuro não é "agendado" — é ativo, aceita avaliação.
  assert.equal(isChallengeScheduled("active", "2026-08-30", "item", now), false);
});

test("lista viva = pessoal sem datas e não encerrada", () => {
  assert.equal(isLivingList({ scope: "personal", startsOn: null, endsOn: null, status: "active" }), true);
  assert.equal(isLivingList({ scope: "personal", startsOn: null, endsOn: null, status: "draft" }), true);
  assert.equal(isLivingList({ scope: "personal", startsOn: null, endsOn: null, status: "closed" }), false, "uma legada encerrada mantém o ciclo para poder reabrir");
  assert.equal(isLivingList({ scope: "personal", startsOn: "2026-01-01", endsOn: "2026-12-31", status: "active" }), false, "com período é uma rodada, não uma lista");
  assert.equal(isLivingList({ scope: "group", startsOn: null, endsOn: null, status: "active" }), false, "grupo nunca é lista viva");
});

test("apresenta período ou ausência de prazo sem datas fictícias", () => {
  assert.equal(ptFormat.dateRange(null, null), "Sem datas");
  assert.match(ptFormat.dateRange("2026-08-01", "2026-08-31"), /01.*ago.*31.*ago/i);
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
  const withPeriod = renderWithIntl(createElement(SchedulePeriodFields, {
    startsOn: "2026-08-30",
    endsOn: "2026-11-27",
    onStartsOn: () => undefined,
    onEndsOn: () => undefined,
  }));
  assert.match(withPeriod, /6 meses/);
  assert.match(withPeriod, /aria-pressed="true"[\s\S]*?>90 dias<\/button>/);
  assert.match(withPeriod, /90 dias · /);

  const empty = renderWithIntl(createElement(SchedulePeriodFields, {
    startsOn: "",
    endsOn: "",
    onStartsOn: () => undefined,
    onEndsOn: () => undefined,
  }));
  assert.match(empty, /hoje, até você escolher/);
});

test("explica por que um registro está indisponível sem chamar futuro de encerrado", () => {
  const scheduled = ptFormat.entryUnavailableMessage({
    challengeStatus: "active",
    isParticipant: true,
    itemStatus: "scheduled",
    opensAt: "2099-01-01T03:00:00.000Z",
  });
  assert.match(scheduled ?? "", /ainda não começou/i);
  assert.doesNotMatch(scheduled ?? "", /desafio.*encerrado/i);
  assert.match(ptFormat.entryUnavailableMessage({ challengeStatus: "draft", isParticipant: true }) ?? "", /rascunho/i);
  assert.match(ptFormat.entryUnavailableMessage({ challengeStatus: "active", isParticipant: false }) ?? "", /não está entre/i);
  assert.match(ptFormat.entryUnavailableMessage({ challengeStatus: "closed", isParticipant: true }) ?? "", /encerrado/i);
  assert.equal(ptFormat.entryUnavailableMessage({ challengeStatus: "active", isParticipant: true, itemStatus: "open" }), null);
});

test("traduz os estados dos checkpoints", () => {
  assert.equal(ptFormat.itemStatusLabel("scheduled"), "Programado");
  assert.equal(ptFormat.itemStatusLabel("open"), "Disponível");
  assert.equal(ptFormat.itemStatusLabel("past_due"), "Prazo encerrado");
  assert.equal(ptFormat.itemStatusLabel("closed"), "Encerrado");
});

test("renderiza estado agendado e regras tituladas em destaque", () => {
  const badge = renderWithIntl(createElement(ChallengeStatusBadge, {
    status: "active",
    startsOn: "2099-01-01",
    submissionMode: "daily",
  }));
  // Text-less status dot: the label lives in the accessible name + tooltip.
  assert.match(badge, /aria-label="Situação: Agendado"/);
  assert.match(badge, /title="Agendado"/);
  assert.match(badge, /rounded-full/);

  // A cine round (item) with a future start is just "Ativo" — no scheduled state.
  const cineFuture = renderWithIntl(createElement(ChallengeStatusBadge, {
    status: "active",
    startsOn: "2099-01-01",
    submissionMode: "item",
  }));
  assert.match(cineFuture, /aria-label="Situação: Ativo"/);

  const activeBadge = renderWithIntl(createElement(ChallengeStatusBadge, { status: "active" }));
  assert.match(activeBadge, /aria-label="Situação: Ativo"/);

  const rules = renderWithIntl(createElement(RuleSectionsView, {
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
  const form = renderWithIntl(createElement(DynamicEntryForm, {
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

test("uma resposta já salva vira um único cartão clicável — sem botão de editar separado", () => {
  const answered = renderWithIntl(createElement(DynamicEntryForm, {
    fields: [{ id: "f1", key: "nota", label: "Nota", type: "rating", required: true, config: { min: 0, max: 5, step: 0.5 } }],
    item: null,
    entry: { id: "e1", values: { f1: 4.5 } },
    canEdit: true,
    onSave: async () => undefined,
    onDelete: async () => undefined,
  }));
  assert.doesNotMatch(answered, />\s*Edit(ar)?\s*</i, "não sobra um rótulo de botão 'Editar' à parte");
  assert.match(answered, /<button[^>]*>[\s\S]*Nota[\s\S]*4,5[\s\S]*<\/button>/, "os valores ficam dentro de um único botão clicável");
});

test("sem botão de excluir: o rótulo 'Excluir registro' não aparece mais em lugar nenhum do formulário", () => {
  // `alwaysEditable` força a exibir o formulário (em vez do resumo) sem
  // precisar simular um clique — é o mesmo modo que a correção do admin usa,
  // e por isso também não mostra "Cancelar" aqui (nada a que voltar).
  const editing = renderWithIntl(createElement(DynamicEntryForm, {
    fields: [{ id: "f1", key: "nota", label: "Nota", type: "rating", required: true, config: { min: 0, max: 5, step: 0.5 } }],
    item: null,
    entry: { id: "e1", values: { f1: 4.5 } },
    canEdit: true,
    alwaysEditable: true,
    onSave: async () => undefined,
    onDelete: async () => undefined,
  }));
  assert.doesNotMatch(editing, /Excluir registro/, "o botão de excluir dedicado não existe mais");
  assert.match(editing, /Salvar alterações/, "salvar continua presente");
});

test("limpar o campo obrigatório e salvar apaga o registro, em vez de bloquear com um erro", () => {
  const fields = [{ id: "f1", key: "nota", label: "Nota", required: true }] as ChallengeField[];
  assert.equal(findMissingRequiredField(fields, { f1: 4.5 }), undefined, "preenchido não falta nada");
  const missing = findMissingRequiredField(fields, { f1: "" });
  assert.equal(missing?.id, "f1", "o campo obrigatório vazio é encontrado");
  assert.equal(findMissingRequiredField(fields, {})?.id, "f1", "nunca preenchido também conta como faltando");

  assert.equal(isEmptySaveADelete(missing, true, true), true, "registro existente + exclusão disponível vira exclusão");
  assert.equal(isEmptySaveADelete(missing, false, true), false, "sem registro existente ainda é só validação (nada a apagar)");
  assert.equal(isEmptySaveADelete(missing, true, false), false, "sem callback de exclusão, continua validação");
  assert.equal(isEmptySaveADelete(undefined, true, true), false, "nada faltando não é uma exclusão");
});

test("aba Resultados ao vivo: sem herói repetido, sem pílulas de nome, sem 'small sample' num solo", () => {
  const challenge = {
    title: "Minha estante",
    scope: "personal",
    participants: [{ id: "u1", userId: "u1", name: "Manuel", username: "manu" }],
    result: null,
    metrics: [
      { id: "m1", label: "Nota média", operation: "average", value: 4.2, formattedValue: "4,2", visibleInResults: true },
      {
        id: "m2",
        label: "Ranking dos livros",
        operation: "average",
        visibleInResults: true,
        series: [
          { key: "b1", label: "Pedro Páramo", value: 5, formattedValue: "5", sampleSize: 1 },
          { key: "b2", label: "Sem nota ainda", value: null, sampleSize: 0 },
        ],
      },
    ],
  } as unknown as ChallengeDetail;

  const html = renderWithIntl(createElement(ResultView, { challenge, onBackToEntry: () => undefined }));
  assert.match(html, /Ranking dos livros/);
  assert.match(html, /Pedro Páramo/);
  assert.doesNotMatch(html, /var\(--spotlight\)/, "não repete o herói da capa");
  assert.doesNotMatch(html, /Minha estante/, "não repete o título do desafio (a capa acima já mostra)");
  assert.doesNotMatch(html, /Manuel/, "num desafio solo não lista o próprio nome");
  assert.doesNotMatch(html, /small sample/i, "linha fina de um solo mostra o valor, não o rótulo");
});

test("aba Resultados: um resultado sem manchete curada não cai de volta no título", () => {
  const challenge = {
    title: "Retrospectiva 2026",
    scope: "group",
    participants: [{ id: "u1", userId: "u1", name: "Ana", username: "ana" }, { id: "u2", userId: "u2", name: "Bruno", username: "bruno" }],
    result: { headline: "", summary: "Fechamos o ano.", metrics: [], comments: [] },
    metrics: [{ id: "m1", label: "Nota média", operation: "average", value: 4, formattedValue: "4", visibleInResults: true }],
  } as unknown as ChallengeDetail;

  const html = renderWithIntl(createElement(ResultView, { challenge }));
  assert.match(html, /Fechamos o ano\./);
  assert.doesNotMatch(html, /Retrospectiva 2026/, "sem headline curada, não mostra o título");
});

test("aba Resultados sem números ainda oferece um caminho de volta ao registro", () => {
  const challenge = {
    title: "Ciclo novo",
    scope: "group",
    participants: [{ id: "u1", userId: "u1", name: "Ana", username: "ana" }, { id: "u2", userId: "u2", name: "Bruno", username: "bruno" }],
    result: null,
    metrics: [{ id: "m1", label: "Nota média", operation: "average", value: null, visibleInResults: true }],
  } as unknown as ChallengeDetail;

  const html = renderWithIntl(createElement(ResultView, { challenge, onBackToEntry: () => undefined }));
  assert.match(html, /Ainda sem números/);
  assert.match(html, /Fazer um registro/);
});

test("header sinaliza logo, perfil e sair como clicáveis", () => {
  const header = renderWithIntl(createElement(AppHeader, {
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
  const header = renderWithIntl(createElement(AppHeader, {
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
