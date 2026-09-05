import assert from "node:assert/strict";
import { createElement } from "react";
import test from "node:test";

import { CheckpointPlanner } from "../app/goa/checkpoint-planner";
import { ListImportPanel } from "../app/goa/list-import-panel";
import { RuleSectionsView } from "../app/goa/rules";
import { DynamicEntryForm, itemEntryTypes, ResultView } from "../app/goa/screens/participant-challenge";
import type { ChallengeDetail, ChallengeField, ImportPreview } from "../app/goa/types";
import { AppHeader, ChallengeStatusBadge, SchedulePeriodFields } from "../app/goa/ui";
import {
  findMissingRequiredField,
  inclusiveDayCount,
  isChallengeScheduled,
  isEmptySaveADelete,
  isLivingList,
  isPersonalChallenge,
  shiftDateKey,
} from "../app/goa/utils";
import { ptFormat, renderWithIntl } from "./helpers/intl";

test("f.error não quebra com um fetch abortado — DOMException carrega um código numérico legado, não string", () => {
  const aborted = new DOMException("The operation was aborted.", "AbortError");
  assert.doesNotThrow(() => ptFormat.error(aborted));
  assert.equal(typeof ptFormat.error(aborted), "string");
});

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

test("desafio pessoal: pelo scope, ou pelo groupId bater com o workspace escondido", () => {
  assert.equal(isPersonalChallenge({ scope: "personal", groupId: "g1" }, null), true, "scope já basta, mesmo sem o id do workspace");
  assert.equal(isPersonalChallenge({ scope: "group", groupId: "ws" }, "ws"), true, "payload antigo sem scope: cai para o id do workspace");
  assert.equal(isPersonalChallenge({ scope: "group", groupId: "g1" }, "ws"), false);
  assert.equal(isPersonalChallenge({ groupId: "ws" }, null), false, "sem scope e sem workspace conhecido, não há como dizer que é pessoal");
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

test("limpar a nota não marca a nota 0 por engano (Number(null) e Number('') são 0 em JS)", () => {
  const cleared = renderWithIntl(createElement(DynamicEntryForm, {
    fields: [{ id: "f1", key: "nota", label: "Nota", type: "rating", required: true, config: { min: 0, max: 5, step: 1 } }],
    item: null,
    entry: { id: "e1", values: { f1: null } },
    canEdit: true,
    alwaysEditable: true,
    onSave: async () => undefined,
  }));
  assert.match(cleared, /aria-pressed="false" aria-label="Nota 0"/, "a nota 0 não aparece marcada quando o valor está vazio");
  assert.doesNotMatch(cleared, /aria-pressed="true"/, "nenhuma nota fica marcada com o campo vazio");
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
  assert.doesNotMatch(html, /<h3/, "um único tema de ranking não precisa de um cabeçalho pra se distinguir de nada");
});

test("aba Resultados agrupa rankings por tema (ranking, por pessoa, o que dividiu opiniões) quando há mais de um", () => {
  const challenge = {
    title: "Retrospectiva do clube",
    scope: "group",
    participants: [{ id: "u1", userId: "u1", name: "Ana", username: "ana" }, { id: "u2", userId: "u2", name: "Bruno", username: "bruno" }],
    result: null,
    metrics: [
      {
        id: "m1", label: "Ranking dos filmes", operation: "bayesian_average", groupBy: "item", visibleInResults: true,
        series: [{ key: "f1", label: "Aftersun", value: 4.5, formattedValue: "4,5", sampleSize: 2 }],
      },
      {
        id: "m2", label: "Viés do indicador", operation: "indicator_bias", groupBy: "participant", visibleInResults: true,
        series: [{ key: "u1", label: "Ana", value: 0.3, formattedValue: "+0,3", sampleSize: 2 }],
      },
      {
        id: "m3", label: "Polarização por filme", operation: "spread", groupBy: "item", visibleInResults: true,
        series: [{ key: "f1", label: "Aftersun", value: 1.1, formattedValue: "1,1", sampleSize: 2 }],
      },
    ],
  } as unknown as ChallengeDetail;

  const html = renderWithIntl(createElement(ResultView, { challenge }));
  const rankingIndex = html.indexOf(">Ranking<");
  const peopleIndex = html.indexOf(">Por pessoa<");
  const debateIndex = html.indexOf(">O que dividiu opiniões<");
  assert.ok(rankingIndex > -1 && peopleIndex > -1 && debateIndex > -1, "as três seções de tema aparecem");
  assert.ok(rankingIndex < peopleIndex && peopleIndex < debateIndex, "ranking, depois por pessoa, depois o que dividiu opiniões");
});

test("ranking do Resultado ordena por nota por padrão e mostra a média crua por trás da nota ajustada", () => {
  const challenge = {
    title: "Cineclube com indicação",
    scope: "group",
    participants: [{ id: "u1", userId: "u1", name: "Ana", username: "ana" }, { id: "u2", userId: "u2", name: "Bruno", username: "bruno" }],
    result: null,
    metrics: [
      {
        id: "m1", label: "Ranking dos filmes", operation: "bayesian_average", groupBy: "item", visibleInResults: true,
        series: [
          { key: "f1", label: "Aftersun", value: 4.2, formattedValue: "4,2", rawValue: 4.5, rawFormattedValue: "4,5", sampleSize: 2, recommendedBy: "Ana", year: 2022 },
          { key: "f2", label: "Stalker", value: 3.9, formattedValue: "3,9", rawValue: 3.9, rawFormattedValue: "3,9", sampleSize: 2, recommendedBy: "Bruno", year: 1979 },
        ],
      },
    ],
  } as unknown as ChallengeDetail;

  const html = renderWithIntl(createElement(ResultView, { challenge }));
  const aftersunIndex = html.indexOf("Aftersun");
  const stalkerIndex = html.indexOf("Stalker");
  assert.ok(aftersunIndex > -1 && stalkerIndex > -1 && aftersunIndex < stalkerIndex, "por padrão ordena por nota — Aftersun (4,2) antes de Stalker (3,9)");
  assert.match(html, /Aftersun \(2022\)/, "o ano sempre aparece ao lado do título, sem precisar marcar nada");
  assert.match(html, /Stalker \(1979\)/, "mesmo pro segundo item");
  assert.match(html, /\(4,5\)/, "mostra a média crua entre parênteses ao lado da nota ajustada, quando diferem");
  assert.doesNotMatch(html, /\(3,9\)<\/span>\s*<span[^>]*>n=/, "quando a nota crua é igual à ajustada, não repete o número");
  assert.doesNotMatch(html, /por Ana|por Bruno/, "o indicador só aparece se a pessoa marcar a caixa 'quem indicou'");
  assert.match(html, />Quem indicou</, "a opção de mostrar quem indicou existe, mesmo desmarcada");
});

test("RankingCard (tema ranking) também trunca um ranking grande, atrás de um botão", () => {
  const series = Array.from({ length: 12 }, (_, index) => ({
    key: `item-${index}`,
    label: `Filme ${index + 1}`,
    value: 5 - index * 0.1,
    formattedValue: (5 - index * 0.1).toFixed(1),
    sampleSize: 3,
  }));
  const challenge = {
    title: "Maratona de ranking",
    scope: "group",
    participants: [{ id: "u1", userId: "u1", name: "Ana", username: "ana" }, { id: "u2", userId: "u2", name: "Bruno", username: "bruno" }],
    result: null,
    metrics: [{ id: "m1", label: "Ranking", operation: "bayesian_average", groupBy: "item", visibleInResults: true, series }],
  } as unknown as ChallengeDetail;

  const html = renderWithIntl(createElement(ResultView, { challenge }));
  for (let position = 1; position <= 8; position += 1) {
    assert.match(html, new RegExp(`Filme ${position}<`), `posição ${position} aparece direto`);
  }
  for (let position = 9; position <= 12; position += 1) {
    assert.doesNotMatch(html, new RegExp(`Filme ${position}<`), `posição ${position} ainda não está no DOM (só some com JS depois do clique)`);
  }
  assert.match(html, /Ver mais 4/, "o botão mostra quantas posições ficaram de fora");
});

test("ranking grande esconde o excedente atrás de um <details> nativo, sem JS", () => {
  const series = Array.from({ length: 12 }, (_, index) => ({
    key: `item-${index}`,
    label: `Item ${index + 1}`,
    value: 5 - index * 0.1,
    formattedValue: (5 - index * 0.1).toFixed(1),
    sampleSize: 3,
  }));
  const challenge = {
    title: "Maratona grande",
    scope: "group",
    participants: [{ id: "u1", userId: "u1", name: "Ana", username: "ana" }, { id: "u2", userId: "u2", name: "Bruno", username: "bruno" }],
    result: null,
    // groupBy "participant" keeps this in MetricBlock's own no-JS <details>
    // truncation (the "ranking" theme now renders through RankingCard
    // instead, which needs JS — see the RankingCard-specific test below).
    metrics: [{ id: "m1", label: "Ranking", operation: "average", groupBy: "participant", visibleInResults: true, series }],
  } as unknown as ChallengeDetail;

  const html = renderWithIntl(createElement(ResultView, { challenge }));
  const [beforeDetails, afterDetails] = html.split(/<details/);
  assert.ok(afterDetails, "uma série com mais de 8 posições ganha um <details>");
  for (let position = 1; position <= 8; position += 1) {
    assert.match(beforeDetails, new RegExp(`Item ${position}<`), `posição ${position} aparece direto`);
  }
  assert.doesNotMatch(beforeDetails, /Item 9</, "a 9ª posição não vaza para fora do <details>");
  for (let position = 9; position <= 12; position += 1) {
    assert.match(afterDetails, new RegExp(`Item ${position}<`), `posição ${position} fica recolhida`);
  }
  assert.match(html, /Ver mais 4/, "o rótulo diz quantas posições estão escondidas");
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
    onOpenPersonalSpace: () => undefined,
    onOpenTemplates: () => undefined,
    onOpenAbout: () => undefined,
    onLogout: async () => undefined,
    onAcceptRequest: async () => undefined,
    onDeclineRequest: async () => undefined,
  }));
  const pointerCount = header.match(/cursor-pointer/g)?.length ?? 0;
  assert.ok(pointerCount >= 3, `esperava cursor clicável nos três controles; recebeu ${pointerCount}`);
  assert.match(header, /aria-label="Sua conta"/);
  assert.match(header, /aria-label="Novidades"/);
  assert.match(header, />Sair<\/button>/);
  assert.match(header, />Início<\/button>/, "há um link 'Início' explícito, não só o logo");
});

test("planejador de checkpoints: mostra semanas, o tipo, o total de duração e a distribuição", () => {
  const challenge = {
    id: "c1",
    status: "draft",
    submissionMode: "item",
    startsOn: "2026-03-02",
    endsOn: "2026-03-29",
    checkpoints: [
      { id: "w1", title: "Semana 1", kind: "week", position: 0, opensAt: "2026-03-02T00:00:00Z", dueAt: "2026-03-08T00:00:00Z", itemCount: 1, totalRuntimeMinutes: 100, timeframe: "past" },
      { id: "w2", title: "Semana 3", kind: "week", position: 1, opensAt: "2026-03-16T00:00:00Z", dueAt: "2026-03-22T00:00:00Z", itemCount: 0, totalRuntimeMinutes: null, timeframe: "future" },
    ],
    items: [
      { id: "i1", title: "Filme A", position: 0, checkpointId: "w1", catalogItem: { id: "ci1", title: "Filme A", runtimeMinutes: 100 } },
      { id: "i2", title: "Filme B", position: 1, checkpointId: null, catalogItem: { id: "ci2", title: "Filme B", runtimeMinutes: 120 } },
    ],
  } as unknown as ChallengeDetail;

  const html = renderWithIntl(createElement(CheckpointPlanner, {
    challenge,
    onSaveCheckpoints: async () => undefined,
    onAssign: async () => undefined,
  }));
  assert.match(html, /Semana 1/);
  assert.match(html, /Semana 3/);
  assert.match(html, /1h40/, "soma a duração dos filmes da semana");
  assert.match(html, /Distribuir em ordem/, "oferece a distribuição sequencial");
  assert.match(html, /Sortear dentro de cada/);
  assert.match(html, /Sem checkpoint/, "há um balde para itens sem checkpoint");
});

test("planejador de checkpoints: um desafio diário com período não edita checkpoints à mão", () => {
  const challenge = {
    id: "c2", status: "active", submissionMode: "daily", startsOn: "2026-03-01", endsOn: "2026-03-10",
    checkpoints: [], items: [],
  } as unknown as ChallengeDetail;
  const html = renderWithIntl(createElement(CheckpointPlanner, {
    challenge, onSaveCheckpoints: async () => undefined, onAssign: async () => undefined,
  }));
  assert.match(html, /gera um checkpoint por dia/i);
  assert.doesNotMatch(html, /Adicionar checkpoint/);
});

test("painel de importação: analisa e depois lista chaves desconhecidas e badges por linha", async () => {
  const preview: ImportPreview = {
    limit: 200,
    catalogKind: "film",
    summary: { total: 3, importable: 1, invalid: 1, duplicatesInCatalog: 0, duplicatesInChallenge: 1, unknownKeys: ["vibe"] },
    rows: [
      { index: 0, title: "Aftersun", valid: true, errors: [], mapped: { author: null, year: 2022, pageCount: null, runtimeMinutes: null, mainGenre: null }, recommendation: { kind: "participant", userId: "u1", name: "Ana" }, existingCatalogItemId: null, duplicateInChallenge: false, unknownKeys: ["vibe"] },
      { index: 1, title: "Filme Repetido", valid: true, errors: [], mapped: { author: null, year: null, pageCount: null, runtimeMinutes: null, mainGenre: null }, recommendation: null, existingCatalogItemId: null, duplicateInChallenge: true, unknownKeys: [] },
      { index: 2, title: "", valid: false, errors: ["Sem título."], mapped: { author: null, year: null, pageCount: null, runtimeMinutes: null, mainGenre: null }, recommendation: null, existingCatalogItemId: null, duplicateInChallenge: false, unknownKeys: [] },
    ],
  };
  const empty = renderWithIntl(createElement(ListImportPanel, {
    onPreview: async () => preview,
    onCommit: async () => undefined,
  }));
  assert.match(empty, /Importar uma lista \(JSON\)/);
  assert.match(empty, /Analisar/);
});

test("expectativa vem antes da avaliação no formulário do item, independente da ordem de criação", () => {
  const challenge = {
    submissionMode: "item",
    fields: [],
    entryTypes: [
      { id: "rating", name: "Avaliação", purpose: "rating", targetPolicy: "required", cardinality: "once_per_item", schedulePolicy: "while_active", isPrimary: true, fields: [] },
      { id: "exp", name: "Expectativa", purpose: "expectation", targetPolicy: "required", cardinality: "once_per_item", schedulePolicy: "while_active", isPrimary: false, fields: [] },
    ],
  } as unknown as ChallengeDetail;
  assert.deepEqual(itemEntryTypes(challenge).map((type) => type.id), ["exp", "rating"], "expectativa primeiro");

  const noExpectation = {
    submissionMode: "item", fields: [],
    entryTypes: [
      { id: "progress", purpose: "progress", targetPolicy: "required", cardinality: "once_per_item_day", schedulePolicy: "while_active", isPrimary: true, fields: [] },
      { id: "done", purpose: "completion", targetPolicy: "required", cardinality: "once_per_item", schedulePolicy: "while_active", isPrimary: false, fields: [] },
    ],
  } as unknown as ChallengeDetail;
  assert.deepEqual(itemEntryTypes(noExpectation).map((type) => type.id), ["progress", "done"], "sem expectativa, a ordem de criação vale");
});

test("header lista convites de grupo pendentes no menu de novidades", () => {
  const header = renderWithIntl(createElement(AppHeader, {
    user: { id: "user-1", name: "Pessoa Teste", username: "pessoa" },
    notifications: [
      { id: "req-1", groupId: "g1", groupName: "Clube do Sofá", role: "participant", invitedBy: "Ana", createdAt: "2026-08-30T12:00:00.000Z" },
    ],
    onHome: () => undefined,
    onAccount: () => undefined,
    onOpenPersonalSpace: () => undefined,
    onOpenTemplates: () => undefined,
    onOpenAbout: () => undefined,
    onLogout: async () => undefined,
    onAcceptRequest: async () => undefined,
    onDeclineRequest: async () => undefined,
  }));
  assert.match(header, /aria-label="Novidades \(1\)"/);
});
