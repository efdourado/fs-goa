import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";

import { ExportDocument } from "../app/goa/export/export-document";
import { buildExportModel, coverLines, longestStreak } from "../app/goa/export/model";
import type { ChallengeDetail, Entry } from "../app/goa/types";
import { renderWithIntl } from "./helpers/intl";

const words = { yes: "Sim", no: "Não", group: "Grupo" };
const rating = {
  id: "rate", name: "Avaliação", semanticKey: "avaliacao", purpose: "rating", answerScope: "individual", parentTypeId: null,
  fields: [
    { id: "nota", key: "nota", label: "Nota", type: "rating", required: true, config: { min: 0, max: 5 } },
    { id: "comentario", key: "comentario", label: "Comentário", type: "text", required: false, config: { multiline: true } },
  ],
};
const progress = {
  id: "prog", name: "Progresso", semanticKey: "progresso", purpose: "progress", answerScope: "individual", parentTypeId: null,
  fields: [{ id: "paginas", key: "paginas", label: "Páginas lidas", type: "number", required: true }],
};
const films = ["Gente Grande", "John Wick", "Projeto Almanaque", "Triângulo do Medo", "O Caso Collini", "The Station Agent", "La La Land"];
const challenge = {
  id: "c", title: "Cine Dupla Rodada 01", status: "active", participants: [
    { id: "p1", userId: "vivi", name: "Vivi" }, { id: "p2", userId: "dudu", name: "Dudu" },
  ],
  entryTypes: [rating, progress],
  checkpoints: [],
  ruleSections: [{ title: "A ordem tem lógica.", description: "Cada filme conversa com o anterior." }],
  items: films.map((title, index) => ({
    id: `f${index}`, title, position: index,
    catalogItem: { id: `cat${index}`, kind: "film", title, year: 2000 + index, runtimeMinutes: 100 },
    recommendedBy: { kind: "member", id: index % 2 ? "dudu" : "vivi", name: index % 2 ? "Dudu" : "Vivi" },
  })),
} as unknown as ChallengeDetail;

const entry = (partial: Partial<Entry> & { id: string }): Entry => ({ values: {}, answerScope: "individual", ...partial });
const entries: Entry[] = [
  entry({ id: "e1", userId: "vivi", participantName: "Vivi", entryTypeId: "rate", itemId: "f0", occurredOn: "2026-09-01", values: { nota: 3, comentario: "'Sabe quando…'\nRi demais." } }),
  entry({ id: "e2", userId: "dudu", participantName: "Dudu", entryTypeId: "rate", itemId: "f0", occurredOn: "2026-09-01", values: { nota: 2 } }),
  entry({ id: "e3", userId: "vivi", participantName: "Vivi", entryTypeId: "rate", itemId: "f1", occurredOn: "2026-09-03", values: { nota: 5 } }),
  entry({ id: "e4", userId: "dudu", participantName: "Dudu", entryTypeId: "rate", itemId: "f1", occurredOn: "2026-09-04", values: { nota: 4.5 } }),
  entry({ id: "e5", userId: "dudu", participantName: "Dudu", entryTypeId: "prog", itemId: "f2", occurredOn: "2026-09-05", values: { paginas: 30 } }),
  entry({ id: "e6", userId: "dudu", participantName: "Dudu", entryTypeId: "prog", itemId: "f2", occurredOn: "2026-09-06", values: { paginas: 45 } }),
];

test("o placar sai das notas: média por item, campeão, maior decepção e média geral", () => {
  const model = buildExportModel({ challenge, entries, userId: "dudu", words });
  const [first, second] = model.chapters.flatMap((chapter) => chapter.items);
  assert.equal(first.ratingAvg, 2.5);
  assert.equal(second.ratingAvg, 4.75);
  assert.equal(model.champion?.title, "John Wick");
  assert.equal(model.disappointment?.title, "Gente Grande");
  assert.equal(model.overallAvg, (3 + 2 + 5 + 4.5) / 4);
  assert.deepEqual(model.people.map((person) => [person.name, person.recommendedCount]), [["Vivi", 4], ["Dudu", 3]]);
});

test("sete itens sem sessões viram blocos de cores seguidas; o progresso de cada dia vira uma linha com total", () => {
  const model = buildExportModel({ challenge, entries, userId: "dudu", words });
  assert.ok(model.chapters.length > 1 && model.chapters.length <= 5);
  assert.deepEqual(model.chapters.flatMap((chapter) => chapter.items.map((item) => item.number)), [1, 2, 3, 4, 5, 6, 7]);
  const almanaque = model.chapters.flatMap((chapter) => chapter.items).find((item) => item.title === "Projeto Almanaque")!;
  assert.equal(almanaque.entries.length, 0);
  assert.equal(almanaque.progress[0].total, 75);
  assert.deepEqual(model.stats.map((stat) => stat.kind), ["items", "entries", "years", "runtime"]);
});

test("só os meus registros deixa de fora o que os outros escreveram", () => {
  const model = buildExportModel({ challenge, entries, userId: "dudu", onlyMine: true, words });
  assert.deepEqual(model.people.map((person) => person.name), ["Dudu"]);
  assert.equal(model.chapters.flatMap((chapter) => chapter.items).flatMap((item) => item.ratings).every((row) => row.personKey === "dudu"), true);
});

test("a maior sequência conta dias seguidos, mesmo virando o mês", () => {
  assert.equal(longestStreak(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-03", "2026-09-01"]), 3);
  assert.equal(longestStreak([]), 0);
});

test("o título da capa quebra em até três linhas", () => {
  assert.deepEqual(coverLines("Cine Dupla 01"), ["Cine", "Dupla", "01"]);
  assert.equal(coverLines("Um ano inteiro de leituras lentas e boas").length, 3);
});

test("o documento mostra capa, regras, cartões e placar preenchido", () => {
  const html = renderWithIntl(createElement(ExportDocument, { challenge, entries, userId: "dudu", fontClassName: "" }));
  assert.match(html, /Vivi &amp; Dudu apresentam/);
  assert.match(html, /A ordem tem lógica\./);
  assert.match(html, /<blockquote>Sabe quando…<\/blockquote>/, "a citação do comentário vira citação");
  assert.match(html, /Campeão<\/span><b>John Wick<\/b>/);
  assert.match(html, /Total: 75/);
  assert.match(html, /Baixar PDF/);
});
