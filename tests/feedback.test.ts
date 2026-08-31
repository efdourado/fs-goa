import assert from "node:assert/strict";
import test from "node:test";

import { submitFeedback } from "../lib/feedback";
import { ApiError } from "../lib/http";

const context = { appVersion: null };
const valid = { area: "criar desafio", goal: "adicionar um filme", impact: "minor" };

async function rejectionCode(body: Record<string, unknown>): Promise<{ status: number; code: string }> {
  try {
    await submitFeedback(null, body, context);
    throw new Error("esperava uma rejeição");
  } catch (error) {
    assert.ok(error instanceof ApiError, `esperava ApiError, recebeu ${String(error)}`);
    return { status: error.status, code: error.code ?? "" };
  }
}

test("feedback exige área e objetivo", async () => {
  assert.equal((await rejectionCode({ ...valid, area: "" })).status, 400);
  assert.equal((await rejectionCode({ ...valid, goal: undefined })).status, 400);
});

test("feedback valida o impacto contra o conjunto conhecido", async () => {
  assert.equal((await rejectionCode({ ...valid, impact: "catastrófico" })).code, "invalid_impact");
  assert.equal((await rejectionCode({ area: "x", goal: "y" })).code, "invalid_impact");
});

test("feedback rejeita facilidade fora de 1..5", async () => {
  assert.equal((await rejectionCode({ ...valid, ease: 0 })).code, "invalid_ease");
  assert.equal((await rejectionCode({ ...valid, ease: 6 })).code, "invalid_ease");
  assert.equal((await rejectionCode({ ...valid, ease: 2.5 })).code, "invalid_ease");
});

test("feedback rejeita textos longos demais e e-mail de contato inválido", async () => {
  assert.equal((await rejectionCode({ ...valid, friction: "x".repeat(4001) })).status, 400);
  assert.equal((await rejectionCode({ ...valid, contactOk: true, contactEmail: "sem-arroba" })).code, "invalid_email");
});
