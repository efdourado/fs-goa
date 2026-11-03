import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { consistencyProgress, parseProgressTracking, performancePlans } from "../lib/progress-tracking";
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
  assert.deepEqual(performancePlans(fields.slice(0, 1), performance), [], "archived factors never silently change the formula");
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
  assert.match(html, /Squat: início 500, melhor 550/);
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
