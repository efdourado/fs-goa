import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { SessionLog, sessionSpecOf, type SessionPayload, type SessionSaveResult } from "../app/goa/session-log";
import { ParticipantChallengeScreen } from "../app/goa/screens/participant-challenge";
import type { ChallengeDetail, Entry } from "../app/goa/types";
import { dateKeyInSaoPaulo } from "../app/goa/utils";
import { withIntl } from "./helpers/intl";

function setup() {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    requestAnimationFrame: (callback: () => void) => { callback(); return 0; },
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
  const root = createRoot(document.getElementById("root")!);
  const button = (label: string) => {
    const found = [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === label || node.getAttribute("aria-label") === label);
    assert.ok(found, `button ${label} exists`);
    return found;
  };
  return { root, button, cleanup: async () => { await act(async () => root.unmount()); dom.window.close(); } };
}

const workout = {
  id: "workout", status: "active", items: [{ id: "bench", title: "Bench", position: 0 }], libraries: [],
  entryTypes: [
    { id: "visit", name: "Treino", fields: [] },
    { id: "record", name: "Exercise", parentTypeId: "visit", fields: [{ id: "weight", label: "Weight", type: "number", required: true }] },
  ],
} as unknown as ChallengeDetail;

test("Done during a pending workout save reuses the returned workout and exercise ids without waiting for props", async () => {
  const ui = setup();
  try {
    const calls: Array<{ payload: SessionPayload; entry?: Entry }> = [];
    let finish!: (saved: SessionSaveResult) => void;
    const first = new Promise<SessionSaveResult>((resolve) => { finish = resolve; });
    const onSave = async (payload: SessionPayload, entry?: Entry) => {
      calls.push({ payload, entry });
      return calls.length === 1 ? first : { id: "saved-visit", children: [{ id: "saved-record", itemId: "bench", values: {} }] };
    };
    await act(async () => ui.root.render(withIntl(<SessionLog challenge={workout} spec={sessionSpecOf(workout)!} entries={[]} userId="me" canEdit onSave={onSave} />)));
    await act(async () => ui.button("Bench+").click());
    await act(async () => ui.button("Mais Weight").click());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 950)); });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].entry, undefined);
    // Editing while the network request is pending must survive its response.
    await act(async () => ui.button("Mais Weight").click());
    await act(async () => ui.button("Pronto").click());
    assert.equal(calls.length, 1, "Done queues its save while the request is pending");
    await act(async () => finish({ id: "saved-visit", children: [{ id: "saved-record", itemId: "bench", values: { weight: 1 } }] }));
    assert.equal(calls.length, 2);
    assert.equal(calls[1].entry?.id, "saved-visit", "the queued save edits the same workout");
    assert.equal(calls[1].payload.children[0].id, "saved-record", "the exercise is updated, not recreated");
    assert.equal(calls[1].payload.children[0].values.weight, 2, "the latest edit is kept");
  } finally { await ui.cleanup(); }
});


test("the inline editor saves immediately on Done, stays visible, and cancels its delayed save", async () => {
  const ui = setup();
  try {
    const calls: SessionPayload[] = [];
    const onSave = async (payload: SessionPayload) => { calls.push(payload); return { id: "visit", children: [{ id: "record", itemId: "bench", values: { weight: 1 } }] }; };
    await act(async () => ui.root.render(withIntl(<SessionLog challenge={workout} spec={sessionSpecOf(workout)!} entries={[]} userId="me" canEdit onSave={onSave} />)));
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(ui.button("Pronto").disabled, true);
    assert.equal(ui.button("Pronto").querySelector("[data-save-lock]")?.getAttribute("data-save-lock"), "closed");
    await act(async () => ui.button("Bench+").click());
    await act(async () => ui.button("Mais Weight").click());
    assert.equal(calls.length, 0, "no entry is created just by opening or typing in the editor");
    assert.equal(ui.button("Pronto").querySelector("[data-save-lock]")?.getAttribute("data-save-lock"), "open");
    assert.ok(ui.button("Pronto").closest("form")?.classList.contains("border"), "fields and save share one bordered form");
    assert.ok(ui.button("Pronto").closest("form")?.classList.contains("bg-[var(--session-surface)]"), "the session uses the visible muted background");
    assert.ok(ui.button("Pronto").classList.contains("w-full"), "Done fills its own row");
    await act(async () => ui.button("Pronto").click());
    assert.equal(calls.length, 1);
    assert.equal(calls[0].children[0].values.weight, 1);
    assert.equal(document.querySelector<HTMLInputElement>('input[type="number"]')?.value, "1");
    assert.match(document.body.textContent!, /Salvo/);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 950)); });
    assert.equal(calls.length, 1, "Done consumed the debounce instead of sending another save later");
  } finally { await ui.cleanup(); }
});

test("a failed Done keeps the inline draft and can be retried", async () => {
  const ui = setup();
  try {
    let calls = 0;
    const onSave = async () => { if (++calls === 1) throw new Error("Offline"); return { id: "visit", children: [{ id: "record", itemId: "bench", values: { weight: 1 } }] }; };
    await act(async () => ui.root.render(withIntl(<SessionLog challenge={workout} spec={sessionSpecOf(workout)!} entries={[]} userId="me" canEdit onSave={onSave} />)));
    await act(async () => ui.button("Bench+").click());
    await act(async () => ui.button("Mais Weight").click());
    await act(async () => ui.button("Pronto").click());
    assert.equal(calls, 1);
    assert.equal(document.querySelector<HTMLInputElement>('input[type="number"]')?.value, "1");
    assert.ok(window.localStorage.length > 0);
    assert.equal(ui.button("Pronto").disabled, false);
    await act(async () => ui.button("Pronto").click());
    assert.equal(calls, 2);
    assert.equal(window.localStorage.length, 0, "the acknowledged draft is removed after retry succeeds");
  } finally { await ui.cleanup(); }
});

test("drafts restore automatically inline and remain separate for two sessions on the same day", async () => {
  const ui = setup();
  try {
    const today = dateKeyInSaoPaulo(new Date());
    const entries = [
      { id: "visit", entryTypeId: "visit", userId: "me", occurredOn: today, values: {} },
      { id: "record", entryTypeId: "record", parentEntryId: "visit", itemId: "bench", userId: "me", values: { weight: 5 } },
    ] as Entry[];
    const legacyKey = `goa.workout.${workout.id}.${today}`;
    window.localStorage.setItem(legacyKey, JSON.stringify({ visitId: "visit", rows: [{ id: "record", itemId: "bench", values: { weight: "" } }], visitValues: {} }));
    let calls = 0;
    await act(async () => ui.root.render(withIntl(<SessionLog challenge={workout} spec={sessionSpecOf(workout)!} entries={entries} userId="me" canEdit onSave={async () => { calls++; return { id: "unexpected", children: [] }; }} />)));
    assert.equal(document.querySelector<HTMLInputElement>('input[type="number"]')?.value, "", "the saved device draft is restored without an extra tap");
    await act(async () => ui.button("Pronto").click());
    assert.equal(calls, 0, "an incomplete record is kept as a draft");
    await act(async () => ui.button("＋ Novo treino").click());
    assert.equal(document.querySelector('input[type="number"]'), null);
    await act(async () => ui.button("Bench5+").click());
    assert.ok(window.localStorage.getItem(`${legacyKey}.new`));
    await act(async () => ui.button("Treino").click());
    assert.equal(document.querySelector<HTMLInputElement>('input[type="number"]')?.value, "", "returning to the earlier session restores its own unfinished values");
    assert.equal(calls, 0);
    assert.ok(window.localStorage.getItem(`${legacyKey}.visit`));
    assert.ok(window.localStorage.getItem(`${legacyKey}.new`));
  } finally { await ui.cleanup(); }
});

test("changing days waits for a pending save and never applies its response to the next day's editor", async () => {
  const ui = setup();
  try {
    const today = dateKeyInSaoPaulo(new Date());
    const previous = new Date(`${today}T12:00:00Z`); previous.setUTCDate(previous.getUTCDate() - 1);
    const yesterday = previous.toISOString().slice(0, 10);
    const entries = [
      { id: "today", entryTypeId: "visit", userId: "me", occurredOn: today, values: {} },
      { id: "today-record", entryTypeId: "record", parentEntryId: "today", itemId: "bench", userId: "me", values: { weight: 1 } },
      { id: "yesterday", entryTypeId: "visit", userId: "me", occurredOn: yesterday, values: {} },
      { id: "yesterday-record", entryTypeId: "record", parentEntryId: "yesterday", itemId: "bench", userId: "me", values: { weight: 7 } },
    ] as Entry[];
    const calls: Array<{ payload: SessionPayload; entry?: Entry }> = [];
    let finish!: (value: SessionSaveResult) => void;
    const pending = new Promise<SessionSaveResult>((resolve) => { finish = resolve; });
    const result = { id: "today", children: [{ id: "today-record", itemId: "bench", values: { weight: 2 } }] };
    await act(async () => ui.root.render(withIntl(<SessionLog challenge={workout} spec={sessionSpecOf(workout)!} entries={entries} userId="me" canEdit onSave={async (payload, entry) => { calls.push({ payload, entry }); return calls.length === 1 ? pending : result; }} />)));
    await act(async () => ui.button("Mais Weight").click());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 950)); });
    assert.equal(calls.length, 1);
    await act(async () => document.querySelector<HTMLButtonElement>(`button[data-day="${yesterday}"]`)!.click());
    assert.equal(document.querySelector<HTMLInputElement>('input[type="number"]')?.value, "2", "keep the current editor while its request is pending");
    await act(async () => finish(result));
    assert.ok(calls.every((call) => call.entry?.id === "today" && call.payload.occurredOn === today));
    assert.equal(document.querySelector<HTMLInputElement>('input[type="number"]')?.value, "7", "the next day's existing values stay intact");
    assert.equal(document.querySelector('[role="dialog"]'), null);
  } finally { await ui.cleanup(); }
});

const cinema = {
  id: "cinema", title: "Movie club", status: "active", scope: "personal", kind: "round", isParticipant: true,
  submissionMode: "item", participants: [], fields: [], checkpoints: [], metrics: [], ruleSections: [], result: null,
  items: [{ id: "film", title: "Film", position: 0 }],
  entryTypes: [
    { id: "expectation", name: "Expectativa", purpose: "expectation", targetPolicy: "required", cardinality: "once_per_item", schedulePolicy: "while_active", fields: [{ id: "guess", key: "guess", label: "Expectativa", type: "rating", required: true }] },
    { id: "rating", name: "Avaliação", purpose: "rating", targetPolicy: "required", cardinality: "once_per_item", schedulePolicy: "while_active", isPrimary: true, fields: [{ id: "score", key: "score", label: "Nota", type: "rating", required: false }] },
  ],
} as unknown as ChallengeDetail;

test("expectation and optional rating share one Save; a guess can be saved before rating", async () => {
  const ui = setup();
  try {
    const types: string[] = [];
    await act(async () => ui.root.render(withIntl(<ParticipantChallengeScreen challenge={cinema} entries={[]} user={{ id: "me" } as never} tab="today" onTab={() => undefined} onBack={() => undefined} onSaveEntry={async (_item, _values, _entry, _date, type) => { types.push(type!); }} />)));
    assert.equal([...document.querySelectorAll("button")].filter((button) => /Salvar/.test(button.textContent ?? "")).length, 1);
    await act(async () => document.querySelector<HTMLButtonElement>('#entry-type-expectation button[aria-label="Nota 4"]')!.click());
    await act(async () => ui.button("Salvar respostas").click());
    assert.deepEqual(types, ["expectation"], "blank actual rating is neither required nor created");
  } finally { await ui.cleanup(); }
});

for (const required of [true, false]) {
  test(`combined Save commits expectation before ${required ? "required" : "optional"} rating`, async () => {
    const ui = setup();
    try {
      const challenge = { ...cinema, entryTypes: cinema.entryTypes.map((type) => type.id === "rating" ? { ...type, fields: type.fields.map((field) => ({ ...field, required })) } : type) };
      const types: string[] = [];
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => { finish = resolve; });
      await act(async () => ui.root.render(withIntl(<ParticipantChallengeScreen challenge={challenge} entries={[]} user={{ id: "me" } as never} tab="today" onTab={() => undefined} onBack={() => undefined} onSaveEntry={async (_item, _values, _entry, _date, type) => {
        types.push(type!);
        if (type === "expectation") await pending;
      }} />)));
      await act(async () => document.querySelector<HTMLButtonElement>('#entry-type-expectation button[aria-label="Nota 4"]')!.click());
      await act(async () => document.querySelector<HTMLButtonElement>('#entry-type-rating button[aria-label="Nota 3"]')!.click());
      await act(async () => ui.button("Salvar respostas").click());
      assert.deepEqual(types, ["expectation"], "rating waits for expectation to commit");
      await act(async () => finish());
      assert.deepEqual(types, ["expectation", "rating"]);
    } finally { await ui.cleanup(); }
  });
}
