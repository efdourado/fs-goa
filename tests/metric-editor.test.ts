import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { metricFields, metricGroupings, metricMinimum } from "../app/goa/metric-editor";
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
  assert.match(html, /amostra pequena/i);
  assert.match(html, /2 de 3 registros/);
  assert.match(html, /Ainda sem registros/);
  assert.match(html, />0<\/strong>/);
  assert.doesNotMatch(html, />5<\/strong>/);
  assert.equal(metricMinimum({ operation: "spread", minSample: 1 }), 1, "presentation never raises a configured threshold");
  assert.equal(metric.series![1].value, null);
});
