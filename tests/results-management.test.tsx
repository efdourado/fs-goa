import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { arrangeResultPages, parseResultPresentation } from "../lib/result-presentation";
import { parseProgressTracking } from "../lib/progress-tracking";
import { AdminMetrics, MetricEditorDialog } from "../app/goa/admin-metrics";
import { metricUpdatePayload } from "../app/goa/metric-editor";
import { useAlmanacPages } from "../app/goa/story/almanac";
import { buildStory, type StoryInput } from "../app/goa/story/model";
import { StoryView } from "../app/goa/story/view";
import type { ChallengeDetail, Metric } from "../app/goa/types";
import { renderWithIntl } from "./helpers/intl";

const metric: Metric = { resultPage: true, id: "combined", label: "Overall rating", operation: "average", fieldIds: ["food", "value"], fieldId: "food", combineOp: "average", entryTypeId: "rating", groupBy: "item", isRating: true, minSample: 2, visibleDuring: true, visibleInResults: true, series: [{ key: "a", label: "Restaurant", value: 4, sampleSize: 2 }] };
const challenge = {
  id: "c", title: "Ratings", scope: "group", status: "active", recipeKey: "custom", submissionMode: "item",
  items: [{ id: "a", title: "Restaurant" }], participants: [{ userId: "ana", name: "Ana" }], checkpoints: [],
  fields: [], metrics: [metric], entryTypes: [{ id: "rating", name: "Rating", purpose: "rating", isPrimary: true, fields: [
    { id: "food", key: "food", label: "Food", type: "rating" }, { id: "value", key: "value", label: "Value", type: "rating" },
  ] }],
} as unknown as ChallengeDetail;
const input: StoryInput = { title: "Test", noun: "item", people: [{ id: "ana", name: "Ana" }], items: [{ id: "a", title: "Restaurant" }], ratings: [{ personId: "ana", itemId: "a", value: 4 }], expectations: [], scale: { min: 0, max: 5 }, days: [], records: [], today: "2026-11-03" };
const noop = async () => {};

function Pages({ value, metrics = [metric] }: { value: StoryInput; metrics?: Metric[] }) {
  const pages = useAlmanacPages(buildStory(value), value, metrics);
  return createElement("div", null, pages.map((page) => createElement("section", { key: page.id, "data-result-page": page.id }, page.body)));
}

test("presentation settings preserve performance and check-in definitions", () => {
  const settings = { performance: { mode: "product", fieldIds: ["weight", "reps"], sessionAggregation: "sum" }, consistency: { target: 4, periodDays: 7, count: "sessions" }, results: { hiddenPages: ["words"], pageOrder: ["records", "streaks"] } };
  assert.deepEqual(parseProgressTracking(settings), settings);
  assert.throws(() => parseResultPresentation({ hiddenPages: ["words", "words"], pageOrder: [] }));
});

test("page order and visibility are shared without mutating the source list", () => {
  const pages = [{ id: "rankings" }, { id: "words" }, { id: "metric-combined" }, { id: "new-page" }];
  assert.deepEqual(arrangeResultPages(pages, { hiddenPages: ["words"], pageOrder: ["metric-combined", "rankings"] }).map((page) => page.id), ["metric-combined", "rankings", "new-page"]);
  assert.equal(pages[0].id, "rankings");
});

test("Results renders configured numeric metrics, honours order, and hides disabled pages", () => {
  const html = renderWithIntl(createElement(Pages, { value: { ...input, resultPresentation: { hiddenPages: ["solo"], pageOrder: ["metric-combined", "rankings"] } } }));
  assert.match(html, /Overall rating/);
  assert.ok(html.indexOf('data-result-page="metric-combined"') < html.indexOf('data-result-page="rankings"'));
  assert.doesNotMatch(html, /data-result-page="solo"/);
  const hidden = renderWithIntl(createElement(Pages, { value: input, metrics: [{ ...metric, visibleInResults: false }] }));
  assert.doesNotMatch(hidden, /data-result-page="metric-combined"/);
});

test("during-challenge visibility remains separate from inclusion in closed results", () => {
  const hidden = renderWithIntl(createElement(Pages, { value: input, metrics: [{ ...metric, visibleDuring: false }] }));
  assert.doesNotMatch(hidden, /data-result-page="metric-combined"/);
  const closed = renderWithIntl(createElement(Pages, { value: { ...input, resultsClosed: true }, metrics: [{ ...metric, visibleDuring: false }] }));
  assert.match(closed, /data-result-page="metric-combined"/);
});

test("the overview can be hidden while metrics still render without story data", () => {
  const empty = { ...input, ratings: [], resultPresentation: { hiddenPages: ["thread"], pageOrder: [] } };
  const html = renderWithIntl(createElement(StoryView, { input: empty, story: buildStory(empty), metrics: [metric] }));
  assert.match(html, /Overall rating/);
  assert.doesNotMatch(html, /The thread|O fio/);
});

test("visibility updates preserve combined ratings, scope and sampling", () => {
  const payload = metricUpdatePayload({ ...metric, countDays: false, cumulative: true, groupBy: "checkpoint", itemId: "a", visibleInResults: false });
  assert.deepEqual(payload.fieldIds, ["food", "value"]);
  assert.equal(payload.isRating, true);
  assert.equal(payload.minSample, 2);
  assert.equal(payload.itemId, "a");
  assert.equal(payload.cumulative, true);
  assert.equal(payload.visibleInResults, false);
});

test("Metrics follows Manage's section layout and uses the shared select in editing dialogs", () => {
  const html = renderWithIntl(createElement(AdminMetrics, { challenge, entries: [], onSaveSettings: noop, onSaveMetric: noop, onDeleteMetric: noop }));
  assert.match(html, /Resultados/);
  assert.doesNotMatch(html, /Páginas dos resultados|Escolha o que aparece nos Resultados/);
  assert.match(html, /Overall rating/);
  assert.match(html, /Mover Overall rating para cima/);
  const editor = renderWithIntl(createElement(MetricEditorDialog, { challenge, metric, onCancel: () => {}, onSave: noop, onDelete: noop }));
  assert.match(editor, /aria-haspopup="listbox"/);
  assert.doesNotMatch(editor, /<select/);
  assert.match(editor, /Food/);
  assert.match(editor, /Value/);
  assert.match(editor, /Usar como nota do desafio/);
});

test("check-in handling has its own section, apart from performance calculations", () => {
  const workout = { ...challenge, metrics: [], trackingSettings: { consistency: { target: 4, periodDays: 7, count: "sessions" } }, entryTypes: [
    { id: "visit", name: "Workout", purpose: "checkin", submissionMode: "daily", fields: [] },
    { id: "exercise", name: "Exercise", parentTypeId: "visit", purpose: "progress", fields: [{ id: "load", key: "load", label: "Weight", type: "number" }] },
  ] } as unknown as ChallengeDetail;
  const html = renderWithIntl(createElement(AdminMetrics, { challenge: workout, entries: [], onSaveSettings: noop, onSaveMetric: noop, onDeleteMetric: noop }));
  assert.doesNotMatch(html, /Cálculos de desempenho/);
  assert.match(html, /Editar Recordes pessoais/);
  assert.match(html, /Como contar os check-ins/);
  assert.match(html, /aria-haspopup="listbox"/);
  assert.doesNotMatch(html, /<select/);
});


test("stored calculation definitions never become result pages without explicit intent", () => {
  const legacy = { ...metric, id: "legacy", label: "Invisible legacy total", resultPage: false };
  const html = renderWithIntl(createElement(Pages, { value: input, metrics: [legacy] }));
  assert.doesNotMatch(html, /Invisible legacy total|data-result-page="metric-legacy"/);
  assert.match(html, /data-result-page="rankings"/, "the existing automatic ranking remains intact");
  const manage = renderWithIntl(createElement(AdminMetrics, { challenge: { ...challenge, metrics: [{ ...legacy, isRating: false }] }, entries: [], onSaveSettings: noop, onSaveMetric: noop, onDeleteMetric: noop }));
  assert.doesNotMatch(manage, /Invisible legacy total/);
});
