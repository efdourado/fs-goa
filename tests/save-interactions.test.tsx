import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { SessionLog, sessionSpecOf, type SessionPayload, type SessionSaveResult } from "../app/goa/session-log";
import { ParticipantChallengeScreen } from "../app/goa/screens/participant-challenge";
import type { ChallengeDetail, Entry } from "../app/goa/types";
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
    await act(async () => ui.button("＋ Registrar as respostas de hoje").click());
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
    await act(async () => ui.button("Salvar").click());
    assert.deepEqual(types, ["expectation"], "blank actual rating is neither required nor created");
  } finally { await ui.cleanup(); }
});

test("unlocking a saved expectation shows only Save with a lock and blocks unchanged answers", async () => {
  const ui = setup();
  try {
    const saved: Array<{type: string | undefined; values: Record<string, unknown>}> = [];
    const entries = [{id:"guess-entry",userId:"me",itemId:"film",entryTypeId:"expectation",values:{guess:3}}] as Entry[];
    await act(async () => ui.root.render(withIntl(<ParticipantChallengeScreen challenge={cinema} entries={entries} user={{id:"me"} as never} tab="today" onTab={() => undefined} onBack={() => undefined} onSaveEntry={async (_item,values,_entry,_date,type) => {saved.push({type,values});}} />)));
    await act(async () => ui.button("Editar resposta").click());
    assert.equal([...document.querySelectorAll("button")].filter((button) => button.textContent?.trim() === "Cancelar").length,0);
    assert.equal(ui.button("Salvar").disabled,true);
    const save = ui.button("Salvar");
    assert.equal(save.querySelectorAll('[data-lock-state]').length,1);
    assert.equal(document.querySelector('#entry-type-expectation button[aria-label="Editar resposta"]'),null);
    await act(async () => document.querySelector<HTMLButtonElement>('#entry-type-expectation button[aria-label="Nota 4"]')!.click());
    assert.equal(save.disabled,false);
    await act(async () => ui.button("Cancelar").click());
    assert.equal([...document.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Salvar"),false);
    await act(async () => ui.button("Editar resposta").click());
    assert.equal(ui.button("Salvar").disabled,true,"closing the lock restores saved answers");
    await act(async () => document.querySelector<HTMLButtonElement>('#entry-type-expectation button[aria-label="Nota 4"]')!.click());
    await act(async () => ui.button("Salvar").click());
    assert.deepEqual(saved,[{type:"expectation",values:{guess:4}}]);
  } finally {await ui.cleanup();}
});

for (const required of [true, false]) {
  test(`Save independently commits expectation and ${required ? "required" : "optional"} rating`, async () => {
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
      await act(async () => ui.button("Salvar").click());
      assert.deepEqual(types, ["expectation", "rating"], "rating saves independently while expectation is pending");
      await act(async () => finish());
      assert.deepEqual(types, ["expectation", "rating"]);
    } finally { await ui.cleanup(); }
  });
}

test("rating can be saved first without filling expectation", async () => {
  const ui=setup(); const saved:string[]=[];
  try {
    await act(async () => ui.root.render(withIntl(<ParticipantChallengeScreen challenge={cinema} entries={[]} user={{id:"me"} as never} tab="today" onTab={() => undefined} onBack={() => undefined} onSaveEntry={async (_item,_values,_entry,_date,type) => {saved.push(type!);}} />)));
    assert.equal(ui.button("Salvar").disabled,true);
    await act(async () => document.querySelector<HTMLButtonElement>('#entry-type-rating button[aria-label="Nota 3"]')!.click());
    await act(async () => ui.button("Salvar").click());
    assert.deepEqual(saved,["rating"]);
  } finally {await ui.cleanup();}
});
