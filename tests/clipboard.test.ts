import assert from "node:assert/strict";
import test from "node:test";

import { copyText } from "../app/goa/clipboard";

function replaceGlobal(name: "window" | "navigator" | "document", value: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  return () => {
    if (original) Object.defineProperty(globalThis, name, original);
    else Reflect.deleteProperty(globalThis, name);
  };
}

test("usa a Clipboard API em contexto seguro", async () => {
  let copied = "";
  const restoreWindow = replaceGlobal("window", { isSecureContext: true });
  const restoreNavigator = replaceGlobal("navigator", {
    clipboard: { writeText: async (text: string) => { copied = text; } },
  });
  try {
    await copyText("segredo-do-link");
    assert.equal(copied, "segredo-do-link");
  } finally {
    restoreNavigator();
    restoreWindow();
  }
});

test("seleciona a origem visível quando a Clipboard API falha", async () => {
  const calls: string[] = [];
  const restoreWindow = replaceGlobal("window", { isSecureContext: true });
  const restoreNavigator = replaceGlobal("navigator", {
    clipboard: { writeText: async () => { throw new Error("permissão negada"); } },
  });
  const restoreDocument = replaceGlobal("document", {
    execCommand: (command: string) => { calls.push(command); return true; },
  });
  const source = {
    value: "link-visível",
    focus: () => { calls.push("focus"); },
    select: () => { calls.push("select"); },
    setSelectionRange: (start: number, end: number) => { calls.push(`range:${start}:${end}`); },
  };

  try {
    await copyText("link-visível", source);
    assert.deepEqual(calls, ["focus", "select", "range:0:12", "copy"]);
  } finally {
    restoreDocument();
    restoreNavigator();
    restoreWindow();
  }
});
