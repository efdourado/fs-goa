import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { consistencyProgress, parseProgressTracking, performancePlans, progressChange } from "../lib/progress-tracking";
import { buildStory, storyFromChallenge, type DatedStory } from "../app/goa/story/model";
import { ProgressSettings } from "../app/goa/progress-settings";
import type { ChallengeDetail, Entry } from "../app/goa/types";
import { renderWithIntl } from "./helpers/intl";

const fields = [
  { id: "load", key: "carga", label: "Carga", type: "number", config: { unit: "kg" } },
  { id: "reps", key: "reps", label: "Repetições", type: "number" },
  { id: "sets", key: "sets", label: "Séries", type: "number" },
];
const challenge = {
  title: "Treino", status: "active", fields, metrics: [], items: [{ id: "squat", title: "Squat" }],
  participants: [{ userId: "ana", name: "Ana" }],
  entryTypes: [
    { id: "visit", purpose: "checkin", fields: [], cardinality: "repeatable", submissionMode: "daily" },
    { id: "record", purpose: "progress", parentTypeId: "visit", fields },
  ],
} as unknown as ChallengeDetail;
const visit = (id: string, day: string) => ({ id, entryTypeId: "visit", userId: "ana", occurredOn: day, values: {} }) as Entry;
const record = (id: string, parentEntryId: string, values: Record<string, unknown>) => ({ id, entryTypeId: "record", parentEntryId, itemId: "squat", userId: "ana", values }) as unknown as Entry;
const entries = [visit("a", "2026-09-01"), visit("b", "2026-09-01"), visit("c", "2026-09-08"),
  record("1", "a", { load: 50, reps: 10, sets: 3 }),
  record("2", "a", { load: 40, reps: 10, sets: 1 }),
  record("3", "b", { load: 60, reps: 5, sets: 3 }),
  record("4", "c", { load: 55, reps: 10, sets: 3 }),
];
const story = (settings: ChallengeDetail["trackingSettings"], rows = entries) => buildStory(storyFromChallenge({ ...challenge, trackingSettings: settings }, rows, "2026-09-08")) as DatedStory;

test("numeric fields never imply a workload formula", () => {
  assert.deepEqual(performancePlans(fields).map((plan) => plan.fields.map((field) => field.id)), [["load"], ["reps"], ["sets"]]);
  assert.equal(story({}).records.length, 3);
});

test("explicit workload supports one recorded set, sets as a multiplier, and multiple sets per session", () => {
  const performance = { mode: "product" as const, fieldIds: ["load", "reps"] };
  const best = story({ performance }).records[0];
  assert.deepEqual(best.series, [500, 300, 550]);
  assert.equal(best.sessions, 3, "two actual sessions on one day remain two sessions");
  assert.equal(best.first, 500);
  assert.equal(best.best, 550, "heavier weight with fewer reps is not automatically a better workload");
  assert.deepEqual(story({ performance: { ...performance, fieldIds: ["load", "reps", "sets"] } }).records[0].series, [1500, 900, 1650]);
  assert.deepEqual(story({ performance: { ...performance, sessionAggregation: "sum" } }).records[0].series, [900, 300, 550]);
});

test("missing factors are excluded, explicit zero remains zero, and the complete first session is the baseline", () => {
  const performance = { mode: "product" as const, fieldIds: ["load", "reps"] };
  const rows = [visit("a", "2026-09-01"), record("1", "a", { load: 0, reps: 10 }), record("2", "a", { load: 50, reps: 10 }),
    visit("b", "2026-09-02"), record("3", "b", { load: 60, reps: "" }),
    visit("c", "2026-09-03"), record("4", "c", { load: 60 }),
    visit("d", "2026-09-04"), record("5", "d", { load: 0, reps: 10 })];
  assert.deepEqual(story({ performance }, rows).records[0].series, [500, 0]);
  assert.equal(story({ performance }, rows).records[0].first, 500);
  assert.ok(performancePlans(fields.slice(0, 1), performance).every((plan) => !plan.product), "archived factors never silently change the formula; remaining fields stay visible");
});

test("four-per-week goals cap each period and leave the current period open", () => {
  const days = [...Array(6).fill("2026-09-01"), "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-15", "2026-09-16"];
  const goal = { target: 4, periodDays: 7, count: "sessions" as const };
  const progress = consistencyProgress(days, "2026-09-01", "2026-09-16", goal, false);
  assert.equal(progress.value, 88, "100% and 75%, without carrying the two extra sessions forward");
  assert.equal(progress.current, 2);
  assert.equal(progress.completed, 2);
  assert.equal(consistencyProgress(days, "2026-09-01", "2026-09-16", { ...goal, count: "days" }, false).value, 50);
  assert.equal(consistencyProgress([], "2026-09-01", "2026-09-03", goal, false).value, null);
  assert.equal(consistencyProgress([], "2026-09-01", "2026-09-08", goal, false).value, 0);
});

test("custom ten-day goals and final partial periods use the saved definition", () => {
  const goal = { target: 3, periodDays: 10, count: "days" as const };
  const progress = consistencyProgress(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-11"], "2026-09-01", "2026-09-11", goal, true);
  assert.equal(progress.value, 67);
  assert.equal(progress.current, null);
  assert.equal(progress.completed, 2);
});

test("tracking settings reject invalid goals, duplicate factors, and incomplete formulas", () => {
  for (const value of [{ consistency: { target: 8, periodDays: 7, count: "days" } }, { consistency: { target: 0, periodDays: 7, count: "sessions" } },
    { performance: { mode: "product", fieldIds: ["load"] } }, { performance: { mode: "product", fieldIds: ["load", "load"] } }]) assert.throws(() => parseProgressTracking(value));
});

test("management shows the formula, session aggregation, and the actual workload preview", () => {
  const html = renderWithIntl(createElement(ProgressSettings, { challenge, entries, value: { performance: { mode: "product", fieldIds: ["load", "reps"] } }, onChange: () => {} }));
  assert.match(html, /Carga × Repetições/);
  assert.match(html, /Squat: início 500, atual 550/);
  assert.match(html, /Somar todos os registros/);
  assert.match(html, /Definir uma meta de consistência/);
});


test("consistency goals include participants with no check-ins", () => {
  const withPeople = { ...challenge, participants: [...challenge.participants, { userId: "ben", name: "Ben" }], trackingSettings: { consistency: { target: 4, periodDays: 7, count: "sessions" as const } } } as ChallengeDetail;
  const result = buildStory(storyFromChallenge(withPeople, entries, "2026-09-08")) as DatedStory;
  const absent = result.lanes.find((lane) => lane.person.id === "ben")!;
  assert.equal(absent.consistency, 0);
  assert.equal(absent.goalProgress?.current, 0);
});

test("two same-day sessions use their submission order even when fetched newest first", () => {
  const rows = entries.map((entry) => entry.id === "a" ? { ...entry, submittedAt: "2026-09-01T08:00:00Z" } : entry.id === "b" ? { ...entry, submittedAt: "2026-09-01T18:00:00Z" } : entry).reverse();
  assert.deepEqual(story({ performance: { mode: "product", fieldIds: ["load", "reps"] } }, rows).records[0].series, [500, 300, 550]);
});

test("separate fields preserve unchanged weight and increased reps instead of choosing a winning percentage", () => {
  const rows = [visit("a", "2026-09-01"), visit("b", "2026-09-08"), record("1", "a", {load: 50, reps: 8}), record("2", "b", {load: 50, reps: 10})];
  const result = story({performance: {mode: "separate", fieldIds: ["load", "reps"]}}, rows);
  assert.deepEqual(result.records.map((row) => [row.label, row.first, row.series.at(-1)]), [["Carga", 50, 50], ["Repetições", 8, 10]]);
});

test("workload is additive to individual measures; summed workload does not sum kilograms", () => {
  const result = story({performance: {mode: "product", fieldIds: ["load", "reps"], sessionAggregation: "sum"}});
  assert.equal(result.records.length, 3);
  assert.deepEqual(result.records.find((row) => row.workload)!.series, [900, 300, 550]);
  assert.deepEqual(result.records.find((row) => row.metricKey === "load")!.series, [50, 60, 55]);
  assert.deepEqual(result.records.find((row) => row.metricKey === "reps")!.series, [10, 5, 10]);
});

test("same-weight context compares the latest lighter weight with its own previous history", () => {
  const rows = [visit("a", "2026-09-01"), visit("b", "2026-09-02"), visit("c", "2026-09-03"),
    record("1", "a", {load: 40, reps: 10}), record("2", "b", {load: 60, reps: 6}), record("3", "c", {load: 40, reps: 15})];
  const result = story({performance: {mode: "separate", fieldIds: ["load", "reps"], rules: {reps: {direction: "higher", contextFieldId: "load"}}}}, rows);
  const context = result.records.find((row) => row.context)!;
  assert.equal(context.context!.value, 40);
  assert.deepEqual(context.series, [10, 15]);
  assert.deepEqual(context.days, ["2026-09-01", "2026-09-03"]);
  assert.equal(context.best, 15);
  assert.deepEqual(result.records.find((row) => row.metricKey === "reps")!.series, [10, 6, 15]);
});

test("unchanged context does not duplicate the same history", () => {
  const rows = [visit("a", "2026-09-01"), visit("b", "2026-09-02"), record("1", "a", {load: 40, reps: 10}), record("2", "b", {load: 40, reps: 15})];
  const result = story({performance: {mode: "separate", fieldIds: ["reps"], rules: {reps: {direction: "higher", contextFieldId: "load"}}}}, rows);
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0].series, [10, 15]);
  assert.equal(result.records[0].context!.value, 40);
});

test("latest and best stay separate when performance drops after a personal best", () => {
  const result = story({performance: {mode: "separate", fieldIds: ["load"]}}).records[0];
  assert.equal(result.first, 50);
  assert.equal(result.best, 60);
  assert.equal(result.series.at(-1), 55);
});

test("lower-is-better uses the lowest value within a session and across history", () => {
  const result = story({performance: {mode: "separate", fieldIds: ["load"], rules: {load: {direction: "lower"}}}}).records[0];
  assert.deepEqual(result.series, [40, 60, 55]);
  assert.equal(result.best, 40);
});

test("explicit set identifiers preserve three independent histories and missing sets stay missing", () => {
  const rows = [visit("a", "2026-09-01"), visit("b", "2026-09-02"),
    ...[1, 2, 3].map((sets) => record(`a${sets}`, "a", {sets, load: 50, reps: 10 - sets})),
    ...[3, 1].map((sets) => record(`b${sets}`, "b", {sets, load: 50, reps: 12 - sets}))];
  const result = story({performance: {mode: "separate", fieldIds: ["reps"], seriesFieldId: "sets"}}, rows);
  assert.deepEqual(result.records.map((row) => [row.seriesValue, row.series]), [[1, [9, 11]], [2, [8]], [3, [7, 9]]]);
});

test("fixed set columns remain independent fields without needing repeated records", () => {
  const fixed = [{id: "set1", key: "set1", label: "Reps 1", type: "number"}, {id: "set2", key: "set2", label: "Reps 2", type: "number"}, {id: "set3", key: "set3", label: "Reps 3", type: "number"}];
  const data = {...challenge, entryTypes: [challenge.entryTypes[0], {...challenge.entryTypes[1], fields: fixed}]} as ChallengeDetail;
  const result = buildStory(storyFromChallenge(data, [visit("a", "2026-09-01"), visit("b", "2026-09-02"), record("1", "a", {set1: 10, set2: 8}), record("2", "b", {set1: 12, set2: 9, set3: 6})], "2026-09-02")) as DatedStory;
  assert.deepEqual(result.records.map((row) => [row.label, row.series]), [["Reps 1", [10, 12]], ["Reps 2", [8, 9]], ["Reps 3", [6]]]);
});

test("descriptive measures use the latest observation without inventing a best performance", () => {
  const result = story({performance: {mode: "separate", fieldIds: ["load"], rules: {load: {direction: "descriptive"}}}}).records[0];
  assert.deepEqual(result.series, [40, 60, 55]);
  assert.equal(result.rule?.direction, "descriptive");
  assert.equal(result.best, 55);
});

test("whitespace, booleans and missing factors are not numeric zero", () => {
  const rows = [visit("a", "2026-09-01"), visit("b", "2026-09-02"), visit("c", "2026-09-03"),
    record("1", "a", {load: " ", reps: 10}), record("2", "b", {load: false, reps: 12}), record("3", "c", {load: 0, reps: 15})];
  const result = story({performance: {mode: "product", fieldIds: ["load", "reps"]}}, rows);
  assert.deepEqual(result.records.find((row) => row.workload)!.series, [0]);
  assert.deepEqual(result.records.find((row) => row.metricKey === "reps")!.series, [10, 12, 15]);
});

test("plain daily numeric challenges expose each measurement without creating library items in storage", () => {
  const data = {...challenge, title: "Running", items: [], entryTypes: [{id: "daily", name: "Response", purpose: "checkin", cardinality: "once_per_day", submissionMode: "daily", fields}]} as unknown as ChallengeDetail;
  const rows = [{...visit("a", "2026-09-01"), entryTypeId: "daily", values: {load: 5, reps: 32}}, {...visit("b", "2026-09-02"), entryTypeId: "daily", values: {load: 5, reps: 29}}] as unknown as Entry[];
  const input = storyFromChallenge(data, rows, "2026-09-02");
  const result = buildStory(input) as DatedStory;
  assert.deepEqual(result.records.map((row) => [row.label, row.series]), [["Carga", [5, 5]], ["Repetições", [32, 29]]]);
  assert.deepEqual(data.items, []);
});


test("change percentages distinguish improvement direction and undefined zero baselines", () => {
  assert.equal(progressChange(50, 50), 0);
  assert.equal(progressChange(8, 10), 25);
  assert.equal(progressChange(32, 29, {direction: "lower"}), 9);
  assert.equal(progressChange(0, 10), null);
  assert.equal(progressChange(-10, -5), 50);
});

test("comparison settings reject invalid directions, self-context and identifier factors", () => {
  for (const performance of [
    {mode: "separate", fieldIds: ["reps"], rules: {reps: {direction: "sideways"}}},
    {mode: "separate", fieldIds: ["reps"], rules: {reps: {direction: "higher", contextFieldId: "reps"}}},
    {mode: "separate", fieldIds: ["reps"], seriesFieldId: "reps"},
    {mode: "separate", fieldIds: ["reps"], seriesFieldId: "sets", rules: {reps: {direction: "higher", contextFieldId: "sets"}}},
  ]) assert.throws(() => parseProgressTracking({performance}));
});

test("existing reference-value comparison settings retain their meaning without adding a finishing goal", () => {
  const rule = {direction: "target" as const, target: 50};
  assert.equal(progressChange(30, 45, rule), 75);
  assert.equal(progressChange(50, 45, rule), null);
  const result = story({performance: {mode: "separate", fieldIds: ["load"], rules: {load: rule}}}).records[0];
  assert.equal(result.best, 50);
  assert.equal(parseProgressTracking({performance: {mode: "separate", fieldIds: ["load"], rules: {load: rule}}}).performance!.rules!.load.target, 50);
  assert.throws(() => parseProgressTracking({performance: {mode: "separate", fieldIds: ["load"], rules: {load: {direction: "target"}}}}));
});
