import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import process from "node:process";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
const nextBin = new URL("../node_modules/next/dist/bin/next", import.meta.url);
const PORT = 3987;
const BASE = `http://127.0.0.1:${PORT}`;

// `npm test` runs `next build` before this file, so `next start` has an
// optimized build to serve. The home route renders the client shell and never
// touches the database, so the smoke test needs no PostgreSQL.
async function withServer(run) {
  const server = spawn(process.execPath, [nextBin.pathname, "start", "-p", String(PORT), "-H", "127.0.0.1"], {
    cwd: projectRoot,
    env: { ...process.env, APP_ORIGIN: BASE, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const logs = [];
  server.stdout.on("data", (chunk) => logs.push(chunk));
  server.stderr.on("data", (chunk) => logs.push(chunk));

  const stop = () => {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      server.kill("SIGKILL");
    }
  };

  try {
    const deadline = Date.now() + 45_000;
    for (;;) {
      if (server.exitCode !== null) {
        throw new Error(`next start exited early:\n${Buffer.concat(logs).toString()}`);
      }
      try {
        const probe = await fetch(BASE, { signal: AbortSignal.timeout(2_000) });
        if (probe.status > 0) break;
      } catch {
        // not ready yet
      }
      if (Date.now() > deadline) throw new Error("next start did not become ready in time");
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return await run();
  } finally {
    stop();
  }
}

test("o servidor de produção renderiza o shell acessível com metadados sociais", { timeout: 90_000 }, async () => {
  await withServer(async () => {
    const response = await fetch(BASE, { headers: { accept: "text/html" } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/i);

    const html = await response.text();
    assert.match(html, /<html[^>]+lang="pt-BR"/i);
    assert.match(html, /<title>Goa — desafios que viram história<\/title>/i);
    assert.match(html, /Carregando o Goa/);
    assert.match(html, /role="status"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /property="og:title" content="Goa — desafios que viram história"/i);
    assert.match(html, new RegExp(`property="og:image" content="${BASE}/og\\.png"`, "i"));
    assert.match(html, /name="twitter:card" content="summary_large_image"/i);
  });
});

test("nao carrega artefatos temporarios do starter", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton|site-creator-vinext-starter|vinext/);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await access(new URL("../public/og.png", import.meta.url));
  await access(projectRoot);
});
