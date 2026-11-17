import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRightIcon, Button, SaveButton } from "../app/goa/ui";
import { DynamicEntryForm } from "../app/goa/screens/participant-challenge";
import { entryValuesReady } from "../app/goa/utils";
import type { ChallengeField } from "../app/goa/types";
import { withIntl } from "./helpers/intl";

function setup() {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById("root")!);
  const save = () => document.querySelector<HTMLButtonElement>('button:has([data-save-lock])')!;
  const icon = () => save().querySelector("[data-save-lock]")!.getAttribute("data-save-lock");
  const input = async (selector: string, value: string) => {
    await act(async () => {
      const field = document.querySelector<HTMLInputElement>(selector)!;
      field.value = value;
      field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  };
  return { root, save, icon, input, cleanup: async () => { await act(async () => root.unmount()); dom.window.close(); } };
}

function NativeForm() {
  const [busy, setBusy] = useState(false);
  const [quantity, setQuantity] = useState<number | string>("");
  return <form>
    <input aria-label="Name" required />
    <input aria-label="Quantity" type="number" min={0} max={5} step={1} required value={quantity} onChange={(event) => setQuantity(event.target.value)} />
    <textarea aria-label="Optional note" />
    <button type="button" onClick={() => setQuantity(0)}>Use zero</button>
    <button type="button" onClick={() => setBusy((value) => !value)}>Toggle busy</button>
    <SaveButton type="submit" disabled={busy}>Save</SaveButton>
    <Button>Continue<ArrowRightIcon /></Button>
  </form>;
}

test("save locks track required fields, native ranges, controlled changes, zero and busy state", async () => {
  const ui = setup();
  try {
    await act(async () => ui.root.render(withIntl(<NativeForm />)));
    assert.equal(ui.save().disabled, true);
    assert.equal(ui.icon(), "closed");
    await ui.input('[aria-label="Name"]', "   ");
    await act(async () => [...document.querySelectorAll("button")].find((button) => button.textContent === "Use zero")!.click());
    assert.equal(ui.save().disabled, true, "whitespace is not a required name");
    await ui.input('[aria-label="Name"]', "Ana");
    assert.equal(ui.save().disabled, false);
    assert.equal(ui.icon(), "open", "a programmatically filled zero is valid");
    await ui.input('[aria-label="Quantity"]', "6");
    assert.equal(ui.save().disabled, true, "a value beyond the range locks the save");
    await ui.input('[aria-label="Quantity"]', "0");
    assert.equal(ui.icon(), "open");
    await act(async () => [...document.querySelectorAll("button")].find((button) => button.textContent === "Toggle busy")!.click());
    assert.equal(ui.icon(), "closed");
    const navigation = [...document.querySelectorAll("button")].find((button) => button.textContent === "Continue")!;
    assert.equal(navigation.querySelector("[data-save-lock]"), null, "navigation keeps its arrow");
  } finally { await ui.cleanup(); }
});

test("required custom yes/no and rating controls unlock for false and zero, and lock when cleared", async () => {
  const ui = setup();
  try {
    const fields: ChallengeField[] = [
      { id: "yesno", key: "yesno", label: "Answer", type: "boolean", required: true },
      { id: "rating", key: "rating", label: "Rating", type: "rating", required: true },
    ];
    const calls: Record<string, unknown>[] = [];
    await act(async () => ui.root.render(withIntl(<DynamicEntryForm fields={fields} item={null} canEdit onSave={async (values) => { calls.push(values); }} />)));
    assert.equal(ui.icon(), "closed");
    await act(async () => [...document.querySelectorAll("button")].find((button) => button.textContent === "Não")!.click());
    assert.equal(ui.icon(), "closed");
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Nota 0"]')!.click());
    assert.equal(ui.icon(), "open");
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Nota 0"]')!.click());
    assert.equal(ui.icon(), "closed");
    assert.equal(calls.length, 0);
  } finally { await ui.cleanup(); }
});

test("custom readiness rejects whitespace, invalid dates and values outside numeric constraints", () => {
  const fields: ChallengeField[] = [
    { id: "name", key: "name", label: "Name", type: "text", required: true },
    { id: "number", key: "number", label: "Number", type: "number", required: true, config: { min: 0, max: 5, step: 1 } },
    { id: "flag", key: "flag", label: "Flag", type: "boolean", required: true },
    { id: "date", key: "date", label: "Date", type: "date", required: true },
  ];
  const good = { name: "Ana", number: 0, flag: false, date: "2026-11-17" };
  assert.equal(entryValuesReady(fields, good), true);
  assert.equal(entryValuesReady(fields, { ...good, name: " " }), false);
  assert.equal(entryValuesReady(fields, { ...good, number: 6 }), false);
  assert.equal(entryValuesReady(fields, { ...good, number: 0.5 }), false);
  assert.equal(entryValuesReady(fields, { ...good, date: "2026-02-30" }), false);
});
