import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, apiRequest, pendingWriteCount } from "../app/goa/api";
import { isBrokenConnectionError } from "../lib/db";

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Swaps `fetch` for one test and puts the real one back after. */
async function withFetch<T>(impl: FetchImpl, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const jsonResponse = (body: string, status = 200, contentType = "application/json; charset=utf-8") =>
  new Response(body, { status, headers: { "content-type": contentType } });

/** A server that never answers, until the request is aborted. */
const hangingFetch: FetchImpl = (_input, init) => new Promise((_resolve, reject) => {
  const aborted = () => reject(new DOMException("The operation was aborted.", "AbortError"));
  // Like the real `fetch`, an already-aborted signal rejects at once.
  if (init?.signal?.aborted) aborted();
  init?.signal?.addEventListener("abort", aborted);
});

async function rejectsWith(promise: Promise<unknown>, status: number, code: string | undefined) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError, `expected ApiError, got ${String(error)}`);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

test("apiRequest returns the JSON body, unwrapping `data`", async () => {
  await withFetch(async () => jsonResponse('{"id":"a1"}'), async () => {
    assert.deepEqual(await apiRequest("/api/x"), { id: "a1" });
  });
  await withFetch(async () => jsonResponse('{"data":[1,2]}'), async () => {
    assert.deepEqual(await apiRequest("/api/x"), [1, 2]);
  });
});

test("apiRequest: a success with an empty or non-JSON body is an error, not a null the screen crashes on", async () => {
  await withFetch(async () => jsonResponse(""), () => rejectsWith(apiRequest("/api/x"), 200, "bad_response"));
  await withFetch(async () => jsonResponse("<html>ok</html>", 200, "text/html"), () => rejectsWith(apiRequest("/api/x"), 200, "bad_response"));
  await withFetch(async () => jsonResponse('{"id":'), () => rejectsWith(apiRequest("/api/x"), 200, "bad_response"));
  await withFetch(async () => jsonResponse("null"), () => rejectsWith(apiRequest("/api/x"), 200, "bad_response"));
  await withFetch(async () => jsonResponse(""), () =>
    rejectsWith(apiRequest("/api/x", { method: "POST", body: {} }), 200, "bad_response_write"));
});

test("apiRequest: an error keeps the server's code and message, and a gateway page falls back to the status", async () => {
  await withFetch(async () => jsonResponse('{"error":"not_found","message":"Grupo não encontrado."}', 404), async () => {
    await assert.rejects(apiRequest("/api/x"), (error: unknown) =>
      error instanceof ApiError && error.status === 404 && error.code === "not_found" && error.message === "Grupo não encontrado.");
  });
  await withFetch(async () => jsonResponse("<html>Gateway Timeout</html>", 504, "text/html"), () => rejectsWith(apiRequest("/api/x"), 504, undefined));
  await withFetch(async () => jsonResponse("", 500), () => rejectsWith(apiRequest("/api/x"), 500, undefined));
});

test("apiRequest: offline is `network`, and a failed write says it may have gone through", async () => {
  const offline: FetchImpl = async () => { throw new TypeError("Failed to fetch"); };
  await withFetch(offline, () => rejectsWith(apiRequest("/api/x"), 0, "network"));
  await withFetch(offline, () => rejectsWith(apiRequest("/api/x", { method: "PATCH", body: {} }), 0, "network_write"));
});

test("apiRequest: a server that never answers times out instead of spinning forever", async () => {
  await withFetch(hangingFetch, () => rejectsWith(apiRequest("/api/x", { timeoutMs: 20 }), 0, "timeout"));
  await withFetch(hangingFetch, () => rejectsWith(apiRequest("/api/x", { method: "POST", body: {}, timeoutMs: 20 }), 0, "timeout_write"));
});

test("apiRequest: a body that stalls after the headers also times out", async () => {
  const stalledBody: FetchImpl = async (_input, init) => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"id":'));
        init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
      },
    });
    return new Response(stream, { headers: { "content-type": "application/json" } });
  };
  await withFetch(stalledBody, () => rejectsWith(apiRequest("/api/x", { timeoutMs: 20 }), 0, "timeout"));
});

test("apiRequest: the caller's own abort stays a quiet AbortError", async () => {
  const controller = new AbortController();
  await withFetch(hangingFetch, async () => {
    const pending = apiRequest("/api/x", { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  });
  const already = new AbortController();
  already.abort();
  await withFetch(hangingFetch, () =>
    assert.rejects(apiRequest("/api/x", { signal: already.signal }), (error: unknown) => error instanceof DOMException && error.name === "AbortError"));
});

test("apiRequest counts writes in flight, so closing the tab can warn, and always counts them back down", async () => {
  const answers: Array<(response: Response) => void> = [];
  await withFetch(() => new Promise<Response>((resolve) => { answers.push(resolve); }), async () => {
    const write = apiRequest("/api/x", { method: "POST", body: {} });
    const read = apiRequest("/api/y");
    assert.equal(pendingWriteCount(), 1, "a read doesn't hold the tab open");
    answers[0](jsonResponse('{"id":"a1"}'));
    await write;
    assert.equal(pendingWriteCount(), 0);
    answers[1](jsonResponse('{"id":"b2"}'));
    await read;
  });
  assert.equal(pendingWriteCount(), 0);
  await withFetch(async () => { throw new TypeError("Failed to fetch"); }, () => apiRequest("/api/x", { method: "DELETE" }).catch(() => undefined));
  await withFetch(hangingFetch, () => apiRequest("/api/x", { method: "POST", body: {}, timeoutMs: 10 }).catch(() => undefined));
  assert.equal(pendingWriteCount(), 0, "failed and timed-out writes are counted back down too");
});

test("a connection is destroyed only when it can't be trusted", () => {
  // Ordinary failures: the connection is fine and goes back to the pool.
  assert.equal(isBrokenConnectionError(Object.assign(new Error("duplicate key"), { code: "23505" })), false);
  assert.equal(isBrokenConnectionError(Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" })), false);
  assert.equal(isBrokenConnectionError(Object.assign(new Error("Grupo não encontrado."), { code: "not_found", status: 404 })), false);
  assert.equal(isBrokenConnectionError(new TypeError("x is undefined")), false);
  assert.equal(isBrokenConnectionError(null), false);
  // The server dropped it, or a reply may still be on its way.
  assert.equal(isBrokenConnectionError(Object.assign(new Error("terminating connection"), { code: "57P01" })), true);
  assert.equal(isBrokenConnectionError(Object.assign(new Error("connection failure"), { code: "08006" })), true);
  assert.equal(isBrokenConnectionError(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })), true);
  assert.equal(isBrokenConnectionError(new Error("Query read timeout")), true);
  assert.equal(isBrokenConnectionError(new Error("Connection terminated unexpectedly")), true);
});
