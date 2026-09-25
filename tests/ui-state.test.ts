import assert from "node:assert/strict";
import { createElement } from "react";
import test from "node:test";

import { CheckpointPlanner } from "../app/goa/checkpoint-planner";
import { parseJsonItemsPaste } from "../app/goa/cine-items";
import { ListImportPanel } from "../app/goa/list-import-panel";
import { RuleSectionsView } from "../app/goa/rules";
import { DynamicEntryForm, itemEntryTypes, ParticipantChallengeScreen, ResultView } from "../app/goa/screens/participant-challenge";
import type { ChallengeDetail, ChallengeField, ImportPreview } from "../app/goa/types";
import { AppHeader, ChallengeStatusBadge, SchedulePeriodFields } from "../app/goa/ui";
import { NewLibraryDialog, TablesLibraryPrompt } from "../app/goa/library-dialogs";
import { WelcomePanel } from "../app/goa/welcome";
import {
  findMissingRequiredField,
  inclusiveDayCount,
  isChallengeScheduled,
  isEmptySaveADelete,
  isLivingList,
  isPersonalChallenge,
  parseCommentBlocks,
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

test("citação vs opinião: um trecho todo entre aspas simples vira bloco de citação; sem aspas nas duas pontas fica texto comum", () => {
  assert.deepEqual(parseCommentBlocks("Só uma opinião comum."), [{ kind: "text", text: "Só uma opinião comum." }]);

  // Colada de uma vez, com quebras de linha no meio — continua UM bloco só,
  // exatamente o problema que o "> " por linha obrigava a repetir.
  assert.deepEqual(
    parseCommentBlocks("'Foi aqui que percebi\nque nada mais importava\nalém daquele momento.'"),
    [{ kind: "quote", text: "Foi aqui que percebi\nque nada mais importava\nalém daquele momento." }],
  );

  // Opinião antes/depois, cada trecho separado por linha em branco.
  assert.deepEqual(
    parseCommentBlocks("Achei incrível.\n\n'Uma frase perfeita.'\n\nRecomendo demais."),
    [
      { kind: "text", text: "Achei incrível." },
      { kind: "quote", text: "Uma frase perfeita." },
      { kind: "text", text: "Recomendo demais." },
    ],
  );

  // Aspas que não envolvem o trecho inteiro (aqui, soltas no meio de uma
  // fala) não disparam nada — o texto sai exatamente como foi digitado.
  assert.deepEqual(
    parseCommentBlocks(`Rick: "vc é um 'cara' esquisito"`),
    [{ kind: "text", text: `Rick: "vc é um 'cara' esquisito"` }],
    "aspas soltas no meio do texto continuam texto normal, sem risco de pegar errado",
  );

  // Aspas aninhadas dentro de um trecho já totalmente envolto não reabrem uma
  // citação própria — só o par mais externo conta, o resto é conteúdo comum.
  assert.deepEqual(
    parseCommentBlocks(`'Rick: "vc é um 'cara' esquisito"'`),
    [{ kind: "quote", text: `Rick: "vc é um 'cara' esquisito"` }],
    "só a borda externa conta; aspas dentro dela ficam como texto normal da própria citação",
  );
});

test("citação aceita aspas curvas do autocorretor do celular (‘…’), retas ou misturadas", () => {
  assert.deepEqual(parseCommentBlocks("‘Frase inteira com aspas curvas.’"), [{ kind: "quote", text: "Frase inteira com aspas curvas." }]);
  assert.deepEqual(parseCommentBlocks("'Aberta reta, fechada curva.’"), [{ kind: "quote", text: "Aberta reta, fechada curva." }]);
});

test("citação pode ter parágrafos (linhas em branco) dentro dela, contanto que abra e feche nas próprias pontas de linha", () => {
  assert.deepEqual(
    parseCommentBlocks(
      "'Rick: \"É engraçado.\"\n\nPhoenixperson: \"Você sempre foi um péssimo amigo.\"'",
    ),
    [{ kind: "quote", text: "Rick: \"É engraçado.\"\n\nPhoenixperson: \"Você sempre foi um péssimo amigo.\"" }],
  );

  // A marca sozinha numa linha (abrindo/fechando) também funciona como um
  // "fence" — e um apóstrofo de contração solto no meio (aqui, 'cause) nunca
  // fecha nada, porque só a ÚLTIMA letra da linha é olhada, nunca o meio.
  const fenced = parseCommentBlocks(
    "'\nPrimeiro parágrafo.\n\nSegundo parágrafo, com um 'cause solto no meio, sem fechar nada.\n\n— Autor\n'",
  );
  assert.deepEqual(fenced, [
    { kind: "quote", text: "Primeiro parágrafo.\n\nSegundo parágrafo, com um 'cause solto no meio, sem fechar nada.\n\n— Autor" },
  ]);
});

test("duas citações no mesmo comentário, separadas por um divisor", () => {
  const value = "'Primeira fala.'\n\n---\n\n'\nSegunda fala,\nem duas linhas.\n'";
  assert.deepEqual(parseCommentBlocks(value), [
    { kind: "quote", text: "Primeira fala." },
    { kind: "divider", text: "" },
    { kind: "quote", text: "Segunda fala,\nem duas linhas." },
  ]);
});

test("uma citação aberta mas nunca fechada some — volta a ser texto comum (com a marca de abertura), em vez de engolir o resto do comentário", () => {
  const value = "'Comecei uma citação\nmas esqueci de fechar.\n\nEsse pedaço seria uma opinião separada.";
  assert.deepEqual(parseCommentBlocks(value), [
    { kind: "text", text: "'Comecei uma citação\nmas esqueci de fechar.\n\nEsse pedaço seria uma opinião separada." },
  ]);
});

test("três traços sozinhos numa linha viram um divisor, separando ideias dentro do mesmo comentário", () => {
  assert.deepEqual(
    parseCommentBlocks("Primeira ideia.\n---\nSegunda ideia, sem relação com a primeira."),
    [
      { kind: "text", text: "Primeira ideia." },
      { kind: "divider", text: "" },
      { kind: "text", text: "Segunda ideia, sem relação com a primeira." },
    ],
  );
  assert.deepEqual(parseCommentBlocks("-- não é divisor (só 2 traços)"), [{ kind: "text", text: "-- não é divisor (só 2 traços)" }]);
  assert.deepEqual(parseCommentBlocks("-----"), [{ kind: "divider", text: "" }], "mais de 3 traços também conta");
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
  assert.match(empty, /Começa hoje, a menos que você escolha datas exatas/);

  // As datas exatas ficam recolhidas quando um atalho explica o período, e abertas quando nenhum explica.
  assert.match(withPeriod, /<details(?![^>]*\sopen)/);
  assert.doesNotMatch(empty, /<details[^>]*\sopen/);
  const custom = renderWithIntl(createElement(SchedulePeriodFields, {
    startsOn: "2026-08-30",
    endsOn: "2026-09-14",
    onStartsOn: () => undefined,
    onEndsOn: () => undefined,
  }));
  assert.match(custom, /<details[^>]*\sopen/);
  assert.match(custom, /Datas exatas/);
});

test("explica por que um registro está indisponível sem chamar futuro de encerrado", () => {
  const scheduled = ptFormat.entryUnavailableMessage({
    challengeStatus: "active",
    isParticipant: true,
    itemStatus: "scheduled",
    opensAt: "2099-01-01T03:00:00.000Z",
  });
  assert.match(scheduled ?? "", /ainda não abriram/i);
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

test("uma resposta já salva mantém os mesmos campos (desabilitados) e troca os botões por um ícone de cadeado", () => {
  const answered = renderWithIntl(createElement(DynamicEntryForm, {
    fields: [{ id: "f1", key: "nota", label: "Nota", type: "rating", required: true, config: { min: 0, max: 5, step: 0.5 } }],
    item: null,
    entry: { id: "e1", values: { f1: 4.5 } },
    canEdit: true,
    onSave: async () => undefined,
    onDelete: async () => undefined,
  }));
  assert.match(answered, /aria-label="Editar resposta"/, "um ícone de cadeado reabre a resposta para edição");
  assert.match(answered, /aria-pressed="true" aria-label="Nota 4,5" disabled/, "o campo continua com o mesmo controle, só que desabilitado");
  assert.doesNotMatch(answered, /Salvar alterações/, "sem a resposta aberta, os botões salvar/cancelar não aparecem");
  assert.doesNotMatch(answered, />Cancelar</, "sem a resposta aberta, os botões salvar/cancelar não aparecem");
});

test("comentário: editando mostra a dica de citação e o botão de inserir; já salvo, a citação vira bloco com borda e o resto vira parágrafo", () => {
  const commentField = { id: "f1", key: "comentario", label: "Comentário", type: "text", required: true, config: { multiline: true, maxLength: 500 } } as ChallengeField;

  const editing = renderWithIntl(createElement(DynamicEntryForm, {
    fields: [commentField],
    item: null,
    canEdit: true,
    onSave: async () => undefined,
  }));
  assert.match(editing, /<textarea/, "ainda editando, o campo real continua sendo o textarea");
  assert.match(editing, /aspas simples/, "a dica do atalho de citação aparece perto do campo");
  assert.match(editing, /Citação/, "o botão que envolve o trecho selecionado em aspas aparece");

  const answered = renderWithIntl(createElement(DynamicEntryForm, {
    fields: [commentField],
    item: null,
    entry: { id: "e1", values: { f1: "Achei ótimo.\n\n'Uma frase marcante do livro.'" } },
    canEdit: true,
    onSave: async () => undefined,
    onDelete: async () => undefined,
  }));
  assert.doesNotMatch(answered, /<textarea/, "campo respondido não mostra mais o textarea, e sim o texto renderizado");
  assert.match(answered, /<p[^>]*>Achei ótimo\.<\/p>/, "o trecho comum vira parágrafo normal");
  assert.match(answered, /<blockquote[^>]*>Uma frase marcante do livro\.<\/blockquote>/, "o trecho entre aspas vira um bloco de citação");
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

test("Terminei (alwaysEditable, só campos opcionais): fica recolhido num botão até o participante abrir", () => {
  const fields = [
    { id: "f-nota", key: "nota", label: "Nota", type: "rating", required: false, config: { min: 0, max: 5, step: 0.5 } },
    { id: "f-com", key: "comentario", label: "Comentário", type: "text", required: false },
  ] as ChallengeField[];

  const collapsed = renderWithIntl(createElement(DynamicEntryForm, {
    fields,
    item: null,
    heading: "Se terminei...",
    alwaysEditable: true,
    canEdit: true,
    onSave: async () => undefined,
  }));
  assert.match(collapsed, /Se terminei\.\.\./, "o botão recolhido usa o próprio heading como rótulo");
  assert.doesNotMatch(collapsed, /<form/, "os campos ficam escondidos até abrir");
  assert.doesNotMatch(collapsed, /Salvar (registro|alterações)/, "o botão de salvar só aparece depois de abrir");

  const filled = renderWithIntl(createElement(DynamicEntryForm, {
    fields,
    item: null,
    heading: "Se terminei...",
    alwaysEditable: true,
    canEdit: true,
    entry: { id: "e1", values: { "f-com": "Ótimo livro" } },
    onSave: async () => undefined,
  }));
  assert.match(filled, /<form/, "já tendo algo preenchido, abre direto");
  assert.match(filled, /Salvar alterações/, "o botão de salvar aparece junto com os campos");
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

  const html = renderWithIntl(createElement(ResultView, { challenge, live: true }));
  assert.match(html, /Ranking dos livros/);
  assert.match(html, /Pedro Páramo/);
  assert.doesNotMatch(html, /var\(--spotlight\)/, "não repete o herói da capa");
  assert.doesNotMatch(html, /Minha estante/, "não repete o título do desafio (a capa acima já mostra)");
  assert.doesNotMatch(html, /Manuel/, "num desafio solo não lista o próprio nome");
  assert.doesNotMatch(html, /small sample/i, "linha fina de um solo mostra o valor, não o rótulo");
  assert.match(html, /<h3[^>]*>Ranking dos livros<\/h3>/, "o nome da métrica é um cabeçalho acessível");
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
  const rankingIndex = html.indexOf(">Rankings<");
  const peopleIndex = html.indexOf(">Por pessoa<");
  const debateIndex = html.indexOf(">Dividiu opiniões<");
  assert.ok(rankingIndex > -1 && peopleIndex > -1 && debateIndex > -1, "as três páginas de tema aparecem");
  assert.ok(rankingIndex < peopleIndex && peopleIndex < debateIndex, "ranking, depois por pessoa, depois o que dividiu opiniões");
});

test("no ranking do Resultado o ano fica ao lado do título e a média crua aparece atrás da ajustada", () => {
  const challenge = {
    title: "Cineclube com indicação",
    scope: "group",
    participants: [{ id: "u1", userId: "u1", name: "Ana", username: "ana" }, { id: "u2", userId: "u2", name: "Bruno", username: "bruno" }],
    result: null,
    metrics: [
      {
        id: "m1", label: "Ranking dos filmes", operation: "bayesian_average", groupBy: "item", visibleInResults: true,
        series: [
          { key: "f1", label: "Aftersun", value: 4.2, formattedValue: "4,2", rawValue: 4.5, rawFormattedValue: "4,5", sampleSize: 2, year: 2022 },
          { key: "f2", label: "Stalker", value: 3.9, formattedValue: "3,9", rawValue: 3.9, rawFormattedValue: "3,9", sampleSize: 2, year: 1979 },
        ],
      },
    ],
  } as unknown as ChallengeDetail;

  const html = renderWithIntl(createElement(ResultView, { challenge }));
  const aftersunIndex = html.indexOf("Aftersun");
  const stalkerIndex = html.indexOf("Stalker");
  assert.ok(aftersunIndex > -1 && stalkerIndex > -1 && aftersunIndex < stalkerIndex, "o servidor já entrega a série ordenada por nota");
  assert.match(html, /Aftersun \(2022\)/, "o ano aparece ao lado do título");
  assert.match(html, /Stalker \(1979\)/, "mesmo pro segundo item");
  assert.match(html, /Média simples: 4,5/, "identifica a média crua quando difere da ajustada");
  assert.doesNotMatch(html, /Média simples: 3,9/, "quando a crua é igual à ajustada, não repete o número");
});

test("ranking grande: mostra as primeiras posições e um botão 'ver a lista completa (12)'", () => {
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
    metrics: [{ id: "m1", label: "Ranking", operation: "bayesian_average", groupBy: "item", visibleInResults: true, series }],
  } as unknown as ChallengeDetail;

  const html = renderWithIntl(createElement(ResultView, { challenge }));
  assert.doesNotMatch(html, /Como este número é calculado/, "o resultado que o participante vê não traz a explicação — ela fica só na aba Métricas");
  assert.doesNotMatch(html, /<details/, "nem disclosure nem scroll — é um botão");
  assert.doesNotMatch(html, /overflow-y-auto/);
  for (let position = 1; position <= 5; position += 1) {
    assert.match(html, new RegExp(`Item ${position}<`), `a posição ${position} aparece direto`);
  }
  assert.doesNotMatch(html, /Item 6</, "a 6ª posição fica atrás do botão");
  assert.match(html, /Ver a lista completa \(12\)/, "o botão diz o total");
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

test("aba Resultados sem números ainda só informa — sem botão de registrar", () => {
  const challenge = {
    title: "Ciclo novo",
    scope: "group",
    participants: [{ id: "u1", userId: "u1", name: "Ana", username: "ana" }, { id: "u2", userId: "u2", name: "Bruno", username: "bruno" }],
    result: null,
    metrics: [{ id: "m1", label: "Nota média", operation: "average", value: null, visibleInResults: true }],
  } as unknown as ChallengeDetail;

  const html = renderWithIntl(createElement(ResultView, { challenge, live: true }));
  assert.match(html, /Ainda sem números/);
  assert.doesNotMatch(html, /Fazer um registro/);
  assert.doesNotMatch(html, /<button/);
});

test("header sinaliza logo, perfil e sair como clicáveis", () => {
  const header = renderWithIntl(createElement(AppHeader, {
    user: { id: "user-1", name: "Pessoa Teste", username: "pessoa" },
    notifications: [],
    onHome: () => undefined,
    onAccount: () => undefined,
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
  assert.doesNotMatch(header, /Meu espaço/, "Meu espaço agora é parte do Início, sem link próprio");
});

test("planejador de etapas: mostra as etapas sem escolha de tipo, o total de duração e a distribuição", () => {
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
  assert.match(html, /Sem etapa/, "há um balde para itens sem etapa");
  assert.doesNotMatch(html, /<option value="(week|session|milestone|day)"/, "etapas não têm mais um tipo para escolher");
  assert.match(html, /Selecionar todos \(2\)/, "dá para marcar todos os itens de uma vez");
  assert.doesNotMatch(html, /Mostrar mais/, "com poucos itens não há botão de mostrar mais");
});

test("planejador de etapas: uma etapa com muitos itens mostra os primeiros e um botão de mostrar mais", () => {
  const items = Array.from({ length: 12 }, (_, index) => ({ id: `i${index}`, title: `Filme ${index + 1}`, position: index, checkpointId: "w1" }));
  const challenge = {
    id: "c9", status: "draft", submissionMode: "item",
    checkpoints: [{ id: "w1", title: "Fase de grupos", kind: "session", position: 0, itemCount: 12, timeframe: "current" }],
    items,
  } as unknown as ChallengeDetail;
  const html = renderWithIntl(createElement(CheckpointPlanner, { challenge, onSaveCheckpoints: async () => undefined, onAssign: async () => undefined }));
  assert.match(html, /Filme 8</);
  assert.doesNotMatch(html, /Filme 9</, "só os oito primeiros aparecem de início");
  assert.match(html, /Mostrar mais 4/);
});

test("planejador de etapas: um desafio com dias automáticos não os edita à mão", () => {
  const challenge = {
    id: "c2", status: "active", submissionMode: "daily", startsOn: "2026-03-01", endsOn: "2026-03-10",
    checkpoints: [{ id: "d1", title: "1 mar", kind: "day", position: 0 }], items: [],
  } as unknown as ChallengeDetail;
  const html = renderWithIntl(createElement(CheckpointPlanner, {
    challenge, onSaveCheckpoints: async () => undefined, onAssign: async () => undefined,
  }));
  assert.match(html, /um registro por dia/i);
  assert.doesNotMatch(html, /Adicionar etapa/);
});

test("planejador de etapas: um desafio diário com período mas SEM dias automáticos ainda organiza por etapas", () => {
  const challenge = {
    id: "c3", status: "active", submissionMode: "daily", startsOn: "2026-03-01", endsOn: "2026-03-31",
    checkpoints: [], items: [{ id: "b1", title: "Um livro", position: 0 }],
  } as unknown as ChallengeDetail;
  const html = renderWithIntl(createElement(CheckpointPlanner, {
    challenge, onSaveCheckpoints: async () => undefined, onAssign: async () => undefined,
  }));
  assert.doesNotMatch(html, /um registro por dia/i);
  assert.match(html, /Adicionar etapa/);
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

test("Hoje: duas seções obrigatórias empilhadas (Expectativa+Avaliação) dividem um único botão de salvar", () => {
  const challenge = {
    id: "t2",
    title: "Cine Curadoria",
    description: "",
    status: "active",
    scope: "group",
    kind: "round",
    startsOn: "2026-01-01",
    endsOn: "2026-06-01",
    submissionMode: "item",
    collectsEntryDate: true,
    participants: [],
    entryTypes: [
      { id: "exp", name: "Expectativa", purpose: "expectation", targetPolicy: "required", cardinality: "once_per_item", schedulePolicy: "while_active", isPrimary: false, fields: [{ id: "f-exp", key: "expectativa", label: "Expectativa", type: "rating", required: true, config: { min: 0, max: 5, step: 0.5 } }] },
      { id: "rating", name: "Avaliação", purpose: "rating", targetPolicy: "required", cardinality: "once_per_item", schedulePolicy: "while_active", isPrimary: true, fields: [{ id: "f-nota", key: "nota", label: "Nota", type: "rating", required: true, config: { min: 0, max: 5, step: 0.5 } }] },
    ],
    fields: [],
    items: [{ id: "i1", title: "Parasita", position: 0, catalogItem: { year: 2019 } }],
    checkpoints: [],
    metrics: [],
    ruleSections: [],
    result: null,
  } as unknown as ChallengeDetail;

  const html = renderWithIntl(createElement(ParticipantChallengeScreen, {
    preview: false,
    user: null,
    challenge,
    entries: [],
    tab: "today",
    onTab: () => undefined,
    onBack: () => undefined,
    onSaveEntry: async () => undefined,
  }));

  assert.match(html, /Salvar respostas/, "um único botão salva as duas seções obrigatórias de uma vez");
  assert.doesNotMatch(html, /Salvar registro/, "cada seção não carrega mais o próprio botão de salvar");
});

test("Wrapped: quando há blocos, o Resultado os renderiza na ordem gravada e pula os escondidos", () => {
  const challenge = {
    title: "Retrospectiva",
    scope: "group",
    participants: [{ id: "u1", userId: "u1", name: "Ana", username: "ana" }, { id: "u2", userId: "u2", name: "Bruno", username: "bruno" }],
    metrics: [],
    result: {
      totalEntries: 12,
      blocks: [
        { id: "b1", kind: "text", position: 0, visible: true, heading: "summary", text: "O clube viu 6 filmes." },
        { id: "b2", kind: "metric", position: 1, visible: false, metric: { id: "mHidden", label: "Métrica escondida", operation: "average", value: 3, formattedValue: "3" } },
        { id: "b3", kind: "metric", position: 2, visible: true, metric: { id: "mShown", label: "Nota média", operation: "average", value: 4.1, formattedValue: "4,1" } },
      ],
    },
  } as unknown as ChallengeDetail;

  const html = renderWithIntl(createElement(ResultView, { challenge }));
  assert.match(html, /O clube viu 6 filmes\./);
  assert.match(html, /Nota média/);
  assert.doesNotMatch(html, /Métrica escondida/, "bloco com visible:false não aparece");
  const summaryIdx = html.indexOf("O clube viu 6 filmes");
  const metricIdx = html.indexOf("Nota média");
  assert.ok(summaryIdx > -1 && metricIdx > summaryIdx, "o resumo (posição 0) vem antes da métrica (posição 2)");
});

test("boas-vindas de quem não tem nada: um caminho em destaque, dois em link, e as quatro partes de uma rodada escondidas até pedir", () => {
  const html = renderWithIntl(createElement(WelcomePanel, { onCreateGroup: () => undefined, onQuickCreate: () => undefined, onOpenTemplates: () => undefined }));
  assert.match(html, />Começar<\/button>/, "o caminho guiado é o botão");
  assert.match(html, />Criar um grupo<\/button>/);
  assert.match(html, />Copiar um que já existe<\/button>/);
  assert.equal((html.match(/<button/g) ?? []).length, 3, "um botão de destaque e dois links — nada além");
  assert.match(html, /<details(?![^>]*\sopen)/, "as quatro partes ficam recolhidas");
  for (const step of ["Escolha o que você acompanha", "Monte um desafio", "Traga sua turma", "Leia a vitrine"]) assert.match(html, new RegExp(step));
  assert.doesNotMatch(html, /Receitas para começar/, "sem os chips de receita que pareciam clicáveis");
});

test("Tables sem biblioteca: convida a criá-la e avisa que dá para criar outras, sem preset nem propriedades de partida", () => {
  const prompt = renderWithIntl(createElement(TablesLibraryPrompt, { scope: "personal", onCreated: () => undefined }));
  assert.match(prompt, /Comece com uma biblioteca Tables/);
  assert.match(prompt, />Criar biblioteca Tables<\/button>/);
  assert.match(prompt, /outras bibliotecas/, "sugere criar mais bibliotecas depois");
  assert.doesNotMatch(prompt, /Bairro|Endereço|cozinha/i);
  const dialog = renderWithIntl(createElement(NewLibraryDialog, { scope: "personal", onCancel: () => undefined, onCreated: () => undefined }));
  assert.match(dialog, /Criar biblioteca/, "o diálogo renderiza");
  assert.doesNotMatch(dialog, /Bairro|Endereço|preset|Biblioteca em branco/i, "criar biblioteca é só dar um nome");
});

test("header lista convites de grupo pendentes no menu de novidades", () => {
  const header = renderWithIntl(createElement(AppHeader, {
    user: { id: "user-1", name: "Pessoa Teste", username: "pessoa" },
    notifications: [
      { id: "req-1", groupId: "g1", groupName: "Clube do Sofá", role: "participant", invitedBy: "Ana", createdAt: "2026-08-30T12:00:00.000Z" },
    ],
    onHome: () => undefined,
    onAccount: () => undefined,
    onOpenTemplates: () => undefined,
    onOpenAbout: () => undefined,
    onLogout: async () => undefined,
    onAcceptRequest: async () => undefined,
    onDeclineRequest: async () => undefined,
  }));
  assert.match(header, /aria-label="Novidades \(1\)"/);
});

test("colagem JSON do wizard presta contas: descarta inválidos e repetidos, mas relata cada um", () => {
  const { rows, summary } = parseJsonItemsPaste(
    JSON.stringify([
      { title: "Solaris", year: 1972, mainGenre: "Ficção científica" },
      { title: "Solaris" },
      { title: "  Stalker  ", diretor: "Tarkovski", tmdbId: 1899 },
      { year: 1979 },
      "Nostalgia",
      [{ title: "Sacrifício" }],
      { title: "Duna" },
    ]),
    new Set(["duna"]),
  );

  assert.deepEqual(rows.map((row) => row.title), ["Solaris", "Stalker"]);
  assert.equal(rows[0]?.mainGenre, "Ficção científica");
  assert.deepEqual(summary, {
    total: 7,
    added: 2,
    // sem título, string solta e array
    invalid: 3,
    // repetido dentro da própria colagem e repetido com a lista existente
    duplicates: 2,
    unknownKeys: ["diretor", "tmdbId"],
  });
});

test("colagem JSON do wizard só lança erro quando o texto não é uma lista de itens", () => {
  assert.throws(() => parseJsonItemsPaste("{", new Set()), /jsonInvalid/);
  assert.throws(() => parseJsonItemsPaste('{"title":"Solaris"}', new Set()), /jsonMustBeArray/);
  assert.throws(() => parseJsonItemsPaste("[]", new Set()), /jsonNoItems/);
  // Uma lista só de repetidos não é erro: vira um resumo com added=0.
  const { rows, summary } = parseJsonItemsPaste('[{"title":"Duna"}]', new Set(["duna"]));
  assert.equal(rows.length, 0);
  assert.equal(summary.duplicates, 1);
});

test("detalhe do modelo: a mesma tela do desafio, só leitura — cabeçalho, regras, cronograma e o Resultado", () => {
  const challenge = {
    id: "t1",
    title: "Cine clube",
    description: "Uma rodada fechada.",
    status: "closed",
    scope: "group",
    kind: "round",
    startsOn: "2026-01-01",
    endsOn: "2026-02-11",
    submissionMode: "item",
    participants: [],
    entryTypes: [],
    fields: [],
    items: [
      { id: "i1", title: "Parasita", position: 0, checkpointId: "w1", catalogItem: { year: 2019 } },
    ],
    checkpoints: [
      { id: "w1", checkpointId: "w1", title: "Semana 1", kind: "week", position: 0, timeframe: "past", itemCount: 1 },
    ],
    metrics: [],
    ruleSections: [{ title: "Uma sessão por semana", description: "Sem spoilers no grupo." }],
    result: {
      headline: "12 filmes",
      summary: "Retrospectiva fictícia.",
      metrics: [{ id: "m1", label: "Nota média", operation: "average", value: 4.1, formattedValue: "4,1" }],
    },
  } as unknown as ChallengeDetail;

  const html = renderWithIntl(createElement(ParticipantChallengeScreen, {
    preview: true,
    user: null,
    challenge,
    entries: [],
    tab: "results",
    onTab: () => undefined,
    onBack: () => undefined,
    previewActions: createElement("span", {}, "Copiar"),
  }));

  assert.match(html, /Cine clube/, "o cabeçalho traz o título");
  assert.match(html, /Sem spoilers no grupo\./, "as regras aparecem");
  assert.match(html, /Semana 1/, "o cronograma aparece");
  assert.match(html, /Nota média/, "o Resultado (vitrine) aparece");
  assert.match(html, /Copiar/, "o CTA de cópia entra no lugar do 'Gerenciar'");
  assert.doesNotMatch(html, /<form/, "nenhum formulário de registro no preview");
  assert.doesNotMatch(html, />Hoje</, "a aba 'Hoje' some no preview");
});

test("dashboard: shelves split by pin, side and status; a mixed Home pools both sides; a hidden side drops out", async () => {
  const { splitShelves, applyColorFilter } = await import("../app/goa/screens/dashboard");
  const c = (over: Partial<import("../app/goa/types").ChallengeSummary>): import("../app/goa/types").ChallengeSummary => ({
    id: over.id ?? "x", groupId: over.groupId ?? "g", title: over.title ?? "T", status: over.status ?? "active", ...over,
  });
  const challenges = [
    c({ id: "pin", status: "active", pinned: true, colorTag: "green" }),
    c({ id: "run", status: "active", colorTag: "green" }),
    c({ id: "solo", groupId: "ws", scope: "personal", status: "active", colorTag: "blue" }),
    c({ id: "run2", status: "active" }),
    c({ id: "old", status: "closed" }),
    c({ id: "soloDraft", groupId: "ws", scope: "personal", status: "draft" }),
  ];
  const ids = (list: Array<{ id: string }>) => list.map((x) => x.id);

  const separated = splitShelves(challenges, "ws");
  assert.deepEqual(ids(separated.pinned), ["pin"]);
  assert.deepEqual(ids(separated.group), ["run", "run2"], "pinned + personal are pulled out of the groups' shelf");
  assert.deepEqual(ids(separated.personal), ["solo"]);
  assert.deepEqual(ids(separated.archive), ["old", "soloDraft"]);
  assert.deepEqual(separated.mixed, []);

  const mixed = splitShelves(challenges, "ws", { mixed: true });
  assert.deepEqual(ids(mixed.mixed), ["run", "solo", "run2"], "both sides in one shelf, the viewer's order kept");
  assert.deepEqual([...mixed.personal, ...mixed.group], []);

  const onlyMine = splitShelves(challenges, "ws", { sections: ["personal"] });
  assert.deepEqual(ids(onlyMine.pinned), [], "a pinned group challenge stays off a Home showing only the person's side");
  assert.deepEqual(ids(onlyMine.personal), ["solo"]);
  assert.deepEqual(ids(onlyMine.archive), ["soloDraft"]);
  assert.deepEqual(onlyMine.group, []);

  assert.deepEqual(ids(applyColorFilter(separated.group, "green")), ["run"]);
  assert.deepEqual(ids(applyColorFilter(separated.group, null)), ["run", "run2"]);
});

test("home view: until the person picks, Home shows the side they use, busiest first; a saved view wins", async () => {
  const { resolveHomeView, visibleSections } = await import("../app/goa/home-view");
  const usage = (personal: number, personalActive: number, groups: number, groupActive: number) => ({ personal, personalActive, groups, groupActive });

  assert.deepEqual(visibleSections(resolveHomeView(null, usage(10, 8, 0, 0))), ["personal"], "solo only → just their side");
  assert.deepEqual(visibleSections(resolveHomeView(null, usage(0, 0, 2, 1))), ["groups"], "groups only → just groups");
  assert.deepEqual(visibleSections(resolveHomeView(null, usage(10, 8, 2, 2))), ["personal", "groups"], "both → the busier side first");
  assert.deepEqual(visibleSections(resolveHomeView(null, usage(1, 1, 2, 5))), ["groups", "personal"]);

  const saved = { layout: "separated" as const, order: ["groups" as const, "personal" as const], hidden: ["personal" as const] };
  assert.deepEqual(resolveHomeView(saved, usage(10, 8, 0, 0)), saved, "the person's choice is kept even against their usage");
  assert.deepEqual(visibleSections({ layout: "mixed", order: ["personal", "groups"], hidden: ["groups"] }), ["personal", "groups"], "mixed always shows both");
});

test("front page: featured templates lead, most recently featured first, topped up with the newest; the rest go below", async () => {
  const { pickFrontPage } = await import("../app/goa/front-page");
  const tpl = (id: string, featuredAt: string | null = null) => ({
    id, title: id, submissionMode: "item" as const, ruleCount: 0, fieldCount: 0, itemCount: 0, metricCount: 0, participantCount: 0,
    publishedAt: "2026-09-01T00:00:00Z", featuredAt,
  });
  const ids = (list: Array<{ id: string }>) => list.map((x) => x.id);
  // The gallery arrives newest-published first.
  const none = pickFrontPage([tpl("new"), tpl("mid"), tpl("old")]);
  assert.deepEqual(ids(none.featured), ["new", "mid"], "nothing featured → the two newest");
  assert.deepEqual(ids(none.rest), ["old"]);

  const one = pickFrontPage([tpl("new"), tpl("mid"), tpl("old", "2026-09-10T00:00:00Z")]);
  assert.deepEqual(ids(one.featured), ["old", "new"], "one featured leads, the newest fills the second slot");
  assert.deepEqual(ids(one.rest), ["mid"]);

  const three = pickFrontPage([tpl("a", "2026-09-01T00:00:00Z"), tpl("b", "2026-09-03T00:00:00Z"), tpl("c", "2026-09-02T00:00:00Z")]);
  assert.deepEqual(ids(three.featured), ["b", "c"], "more than two featured → the two most recently featured");
  assert.deepEqual(ids(three.rest), ["a"]);
});

test("front page story: a ranking's winner, the most in-tune pair and the toughest critic come before plain numbers; the completion rate never shows", async () => {
  const { storyExcerpt } = await import("../app/goa/front-page");
  const labels = { inTune: "Most in tune", critic: "Toughest critic", criticNote: (a: string) => `average ${a}`, fmt: (n: number) => String(n) };
  const person = (userId: string, name: string, ratingsMean: number | null) => ({ userId, name, ratingsMean });
  const challenge = {
    id: "c", groupId: "g", title: "T", status: "closed", participants: [{ id: "u1" }, { id: "u2" }], metrics: [], fields: [],
    result: {
      blocks: [
        { id: "b0", kind: "metric", position: 0, visible: true, metric: { id: "m0", label: "Completion", operation: "completion_rate", value: 1, formattedValue: "100%", sampleSize: 9 } },
        { id: "b1", kind: "metric", position: 1, visible: true, metric: { id: "m2", label: "Average", operation: "average", value: 4.2, formattedValue: "4.2", sampleSize: 9 } },
        { id: "b1b", kind: "metric", position: 1, visible: true, metric: { id: "m4", label: "Pages per week", operation: "sum", groupBy: "checkpoint", series: [{ key: "w1", label: "Week 1", value: 496, formattedValue: "496", sampleSize: 3 }] } },
        { id: "b1c", kind: "metric", position: 1, visible: true, metric: { id: "m5", label: "Pages by genre", operation: "sum", groupBy: "genre", series: [{ key: "g", label: "Fiction", value: 822, formattedValue: "822", sampleSize: 3 }] } },
        { id: "b2", kind: "metric", position: 2, visible: true, metric: { id: "m1", label: "Top film", operation: "average", groupBy: "item", series: [{ key: "k", label: "Aftersun", value: 4.8, formattedValue: "4.8", sampleSize: 3 }] } },
        { id: "b3", kind: "metric", position: 3, visible: false, metric: { id: "m3", label: "Hidden", operation: "average", series: [{ key: "h", label: "Nope", value: 5, formattedValue: "5", sampleSize: 3 }] } },
        { id: "b4", kind: "affinity", position: 4, visible: true, affinity: { minSample: 3, scale: 5, compositeAvailable: false, pairs: [
          { a: { userId: "u1", name: "Ana" }, b: { userId: "u2", name: "Bia" }, sampleSize: 4, direct: 0.4, composite: null, dimensions: [], skippedDimensions: [] },
          { a: { userId: "u1", name: "Ana" }, b: { userId: "u3", name: "Caio" }, sampleSize: 4, direct: 0.9, composite: null, dimensions: [], skippedDimensions: [] },
        ] } },
        { id: "b5", kind: "ranking", position: 5, visible: true, ranking: [person("u1", "Ana", 4.1), person("u2", "Bia", 2.3), person("u3", "Caio", null)] },
        { id: "b6", kind: "entry_value", position: 6, visible: true, comment: { id: "x", text: "Best night of the year.", itemTitle: "Aftersun" } },
      ],
    },
  } as unknown as import("../app/goa/types").ChallengeDetail;
  const excerpt = storyExcerpt(challenge, 5, labels);
  assert.deepEqual(excerpt.stats, [
    { label: "Top film", value: "Aftersun", note: "4.8" },
    { label: "Most in tune", value: "Ana & Caio", note: "0.9" },
    { label: "Toughest critic", value: "Bia", note: "average 2.3" },
    { label: "Pages by genre", value: "Fiction", note: "822" },
    { label: "Average", value: "4.2" },
  ], "no completion rate, no timeline 'winner', a hidden block stays hidden, an item ranking leads, stories before bookkeeping");
  assert.deepEqual(excerpt.quote, { text: "Best night of the year.", itemTitle: "Aftersun" });
  assert.equal(storyExcerpt(challenge, 2, labels).stats.length, 2);
});
