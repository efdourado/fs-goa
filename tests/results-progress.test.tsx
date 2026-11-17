import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { JSDOM } from "jsdom";
import { useAlmanacPages } from "../app/goa/story/almanac";
import { buildStory, storyFromChallenge } from "../app/goa/story/model";
import type { ChallengeDetail, Entry } from "../app/goa/types";
import { withIntl } from "./helpers/intl";

const fields = [{id: "weight", key: "weight", label: "Weight", type: "number", config: {unit: "kg"}}, {id: "reps", key: "reps", label: "Reps", type: "number"}];
const base = {title: "Workout", status: "active", fields, metrics: [], items: [{id: "squat", title: "Squat"}], participants: [{userId: "ana", name: "Ana"}], entryTypes: [{id: "visit", purpose: "checkin", cardinality: "repeatable", submissionMode: "daily", fields: []}, {id: "record", purpose: "progress", parentTypeId: "visit", fields}]} as unknown as ChallengeDetail;
function rows(values: Array<[number, number]>): Entry[] {
  return values.flatMap(([weight, reps], index) => [{id: `day${index}`, entryTypeId: "visit", userId: "ana", occurredOn: `2026-09-0${index + 1}`, values: {}}, {id: `record${index}`, entryTypeId: "record", parentEntryId: `day${index}`, itemId: "squat", userId: "ana", values: {weight, reps}}]) as unknown as Entry[];
}
function Result({challenge = base, entries}: {challenge?: ChallengeDetail; entries: Entry[]}) {
  const input = storyFromChallenge(challenge, entries, "2026-09-08");
  const pages = useAlmanacPages(buildStory(input), input, [], true, true);
  return <>{pages.find((page) => page.id === "records")?.body}</>;
}
async function setup(challenge: ChallengeDetail, entries: Entry[]) {
  const dom = new JSDOM('<div id="root"></div>', {url: "http://localhost"});
  Object.assign(globalThis, {window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, requestAnimationFrame: (callback: () => void) => {callback(); return 0;}, IS_REACT_ACT_ENVIRONMENT: true});
  dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
  dom.window.HTMLDialogElement.prototype.showModal = function() {this.open = true;};
  dom.window.HTMLDialogElement.prototype.close = function() {this.open = false;};
  dom.window.matchMedia = (() => ({matches: false, addEventListener() {}, removeEventListener() {}})) as unknown as typeof dom.window.matchMedia;
  const {createRoot} = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(withIntl(<Result challenge={challenge} entries={entries} />)));
  return {cleanup: async () => {await act(async () => root.unmount()); dom.window.close();}};
}

test("Results identify each field and show start-to-latest instead of start-to-best", async () => {
  const ui = await setup(base, rows([[50, 8], [60, 10], [55, 12]]));
  try {
    const buttons = [...document.querySelectorAll("button")];
    assert.equal(buttons.length, 2);
    assert.match(buttons[0].textContent!, /Weight/);
    assert.match(buttons[0].textContent!, /50 kg → 55 kg/);
    assert.match(buttons[1].textContent!, /Reps/);
    assert.match(buttons[1].textContent!, /8 → 12/);
    await act(async () => buttons[0].click());
    const stats = Object.fromEntries([...document.querySelectorAll("dialog dl > div")].map((node) => [node.querySelector("dt")!.textContent, node.querySelector("dd")!.textContent]));
    assert.equal(stats["Mais recente"], "55 kg");
    assert.equal(stats["Sessão anterior"], "60 kg");
    assert.equal(stats["Recorde"], "60 kg");
    assert.equal(stats["Começo"], "50 kg");
  } finally {await ui.cleanup();}
});

test("contextual history can be opened independently after lowering the weight", async () => {
  const challenge = {...base, trackingSettings: {performance: {mode: "separate" as const, fieldIds: ["weight", "reps"], rules: {reps: {direction: "higher" as const, contextFieldId: "weight"}}}}};
  const ui = await setup(challenge, rows([[40, 10], [60, 6], [40, 15]]));
  try {
    const context = [...document.querySelectorAll("button")].find((button) => button.textContent!.includes("Weight: 40 kg"))!;
    assert.ok(context);
    assert.match(context.textContent!, /10 → 15/);
    await act(async () => context.click());
    const history = document.querySelector("dialog ul")!.textContent!;
    assert.match(history, /15/); assert.match(history, /10/);
    assert.doesNotMatch(history, /6 set/);
    assert.equal(document.querySelectorAll("dialog ul li").length, 2);
  } finally {await ui.cleanup();}
});

test("lower-is-better marks the actual minimum in the chart and history", async () => {
  const challenge = {...base, trackingSettings: {performance: {mode: "separate" as const, fieldIds: ["reps"], rules: {reps: {direction: "lower" as const}}}}};
  const ui = await setup(challenge, rows([[5, 32], [5, 29], [5, 30]]));
  try {
    await act(async () => document.querySelector("button")!.click());
    const chart = document.querySelector("dialog svg[role=img]")!;
    assert.equal(chart.querySelector("text")!.textContent, "29");
    const bestRow = [...document.querySelectorAll("dialog ul li")].find((node) => node.textContent!.includes("Recorde"))!;
    assert.match(bestRow.textContent!, /29/);
  } finally {await ui.cleanup();}
});

test("descriptive fields have neutral change and no personal-best award", async () => {
  const challenge = {...base, trackingSettings: {performance: {mode: "separate" as const, fieldIds: ["weight"], rules: {weight: {direction: "descriptive" as const}}}}};
  const ui = await setup(challenge, rows([[70, 10], [69, 10]]));
  try {
    assert.doesNotMatch(document.body.textContent!, /Novo recorde/);
    await act(async () => document.querySelector("button")!.click());
    assert.doesNotMatch(document.querySelector("dialog dl")!.textContent!, /Recorde/);
    assert.equal(document.querySelectorAll("dialog .text-\\[var\\(--danger\\)\\]").length, 0);
  } finally {await ui.cleanup();}
});


test("a decline is labelled as a decline rather than negative improvement", async () => {
  const ui = await setup(base, rows([[50, 10], [40, 12]]));
  try {
    assert.match(document.body.textContent!, /20% de queda desde o início/);
    assert.doesNotMatch(document.body.textContent!, /-20% de melhora/);
  } finally {await ui.cleanup();}
});
