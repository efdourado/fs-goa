import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { canRankItems, defaultRankingFieldIds, metricFields, metricGroupings, metricMinimum } from "../app/goa/metric-editor";
import { MetricBlock } from "../app/goa/metrics-view";
import { MetricEditor } from "../app/goa/screens/metrics";
import type { ChallengeDetail, Metric } from "../app/goa/types";
import { renderWithIntl } from "./helpers/intl";

const reading = {
  recipeKey: "library", scope: "group", checkpoints: [],
  fields: [{ id: "pages", label: "Páginas lidas", type: "number" }],
  entryTypes: [
    { name: "Progresso", purpose: "progress", fields: [{ id: "pages", label: "Páginas lidas", type: "number" }] },
    { name: "Terminei", purpose: "completion", fields: [{ id: "rating", label: "Nota", type: "rating" }, { id: "comment", label: "Comentário", type: "text" }] },
  ],
} as unknown as ChallengeDetail;

test("metric editing includes ratings from the completion form without duplicating primary fields", () => {
  const fields = metricFields(reading);
  assert.deepEqual(fields.map((field) => [field.id, field.source]), [["pages", "Progresso"], ["rating", "Terminei"]]);
  const html = renderWithIntl(createElement(MetricEditor, {
    challenge: reading, metric: { id: "ranking", label: "Ranking", operation: "bayesian_average", fieldId: "rating", groupBy: "item", minSample: 3 }, onCancel: () => undefined, onSave: async () => undefined,
  }));
  assert.match(html, /value="rating" selected=""/);
  assert.match(html, /Nota · Terminei/);
  assert.doesNotMatch(html, /<details open=""/);
  assert.doesNotMatch(html, /type="submit"[^>]*disabled/);
});

test("grouping choices respect operation and personal context", () => {
  assert.deepEqual(metricGroupings(reading, "completion_rate"), ["none"]);
  assert.deepEqual(metricGroupings(reading, "count"), ["none", "participant", "item"]);
  assert.ok(!metricGroupings({ ...reading, scope: "personal" }, "average").includes("participant"));
  assert.ok(!metricGroupings({ ...reading, recipeKey: "habit" }, "average").includes("item"));
});

test("small samples stay ineligible and explain the configured threshold, including custom thresholds", () => {
  const metric: Metric = { id: "ranking", label: "Ranking", operation: "bayesian_average", minSample: 3, series: [
    { key: "eligible", label: "Elegível", value: 0, formattedValue: "0", sampleSize: 3 },
    { key: "pending", label: "Amostra incompleta", value: null, formattedValue: "—", rawValue: 5, sampleSize: 2 },
    { key: "empty", label: "Sem respostas", value: null, sampleSize: 0 },
  ] };
  const html = renderWithIntl(createElement(MetricBlock, { metric }));
  assert.match(html, /2 de 3 registros/);
  assert.match(html, /Ainda sem registros/);
  assert.match(html, />0<\/strong>/);
  assert.doesNotMatch(html, />5<\/strong>/);
  assert.equal(metricMinimum({ operation: "spread", minSample: 1 }), 1, "presentation never raises a configured threshold");
  assert.equal(metric.series![1].value, null);
});

test("'como este número é calculado' só aparece quando quem renderiza pede — a aba Métricas do admin, nunca o resultado do participante", () => {
  const metric: Metric = { id: "m", label: "Ranking", operation: "bayesian_average", bayesPriorWeight: 4, minSample: 2, series: [
    { key: "a", label: "Filme", value: 4.2, formattedValue: "4.2", sampleSize: 3 },
  ] };
  const plain = renderWithIntl(createElement(MetricBlock, { metric }));
  assert.doesNotMatch(plain, /Como este número é calculado/);
  const admin = renderWithIntl(createElement(MetricBlock, { metric, showExplanation: true }));
  assert.match(admin, /Como este número é calculado/);
  assert.match(admin, /4 × média geral/, "a fórmula usa o peso configurado");
});

const restaurants = {
  recipeKey: "tables", scope: "group", checkpoints: [], submissionMode: "item",
  fields: [
    { id: "comida", label: "Comida", type: "rating" },
    { id: "ambiente", label: "Ambiente", type: "rating" },
    { id: "preco", label: "Preço médio", type: "number" },
    { id: "obs", label: "Observação", type: "text" },
  ],
  entryTypes: [],
} as unknown as ChallengeDetail;

test("uma receita com itens (Tables, personalizada) também agrupa e ranqueia por item — não só filmes e livros", () => {
  assert.ok(metricGroupings(restaurants, "average").includes("item"), "Tables agrupa por item");
  assert.ok(metricGroupings({ ...restaurants, recipeKey: "custom" }, "average").includes("item"), "uma personalizada também");
  assert.ok(!metricGroupings({ ...restaurants, recipeKey: "habit", submissionMode: "daily" }, "average").includes("item"), "um hábito não tem itens para ranquear");
  assert.equal(canRankItems(restaurants), true);
  assert.equal(canRankItems({ ...restaurants, recipeKey: "habit", submissionMode: "daily" }), false, "sem itens não há ranking");
  assert.equal(canRankItems({ ...restaurants, fields: [], entryTypes: [] }), false, "sem nada numérico para ordenar também não");
});

test("ranking novo: as notas já vêm marcadas e o agrupamento é por item, sem perguntar", () => {
  assert.deepEqual(defaultRankingFieldIds(metricFields(restaurants)), ["comida", "ambiente"], "só as notas — preço e texto ficam de fora");
  const html = renderWithIntl(createElement(MetricEditor, { challenge: restaurants, ranking: true, onCancel: () => undefined, onSave: async () => undefined }));
  assert.match(html, /value="Melhores itens"/, "nome de partida");
  assert.match(html, /checked=""[^>]*/, "as notas começam marcadas");
  assert.match(html, /Como pontuar/);
  assert.doesNotMatch(html, /Agrupar por/, "o agrupamento fica travado em item");
  assert.doesNotMatch(html, /type="submit"[^>]*disabled/, "já dá para adicionar sem mexer em nada");
});
