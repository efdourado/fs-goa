import assert from "node:assert/strict";
import test from "node:test";

import { screenFromUrl, urlForScreen } from "../app/goa/navigation";

test("resolve links canônicos e mantém compatibilidade com query de convite", () => {
  assert.deepEqual(screenFromUrl("/", "?invite=abc"), { kind: "invite", token: "abc" });
  assert.deepEqual(screenFromUrl("/invites/abc%20123"), { kind: "invite", token: "abc 123" });
  assert.deepEqual(screenFromUrl("/groups/group-1"), { kind: "group", groupId: "group-1" });
  assert.deepEqual(screenFromUrl("/groups/group-1", "?create=challenge"), {
    kind: "create-challenge",
    groupId: "group-1",
  });
});

test("resolve links de desafio, gestão e abas válidas", () => {
  assert.deepEqual(screenFromUrl("/challenges/ch-1", "?tab=today"), {
    kind: "challenge",
    challengeId: "ch-1",
    tab: "today",
  });
  assert.deepEqual(screenFromUrl("/challenges/ch-1/manage", "?tab=participants"), {
    kind: "admin",
    challengeId: "ch-1",
    tab: "participants",
  });
  assert.deepEqual(screenFromUrl("/challenges/ch-1", "?tab=invalid"), {
    kind: "challenge",
    challengeId: "ch-1",
    tab: "results",
  });
});

test("gera URLs compartilháveis sem expor estado transitório", () => {
  assert.equal(urlForScreen({ kind: "group", groupId: "g/1" }), "/groups/g%2F1");
  assert.equal(
    urlForScreen({ kind: "admin", challengeId: "c-1", tab: "metrics" }),
    "/challenges/c-1/manage?tab=metrics",
  );
});

test("resolve a vitrine pública de modelos e mantém compatibilidade com /templates", () => {
  assert.deepEqual(screenFromUrl("/modelos"), { kind: "templates" });
  assert.deepEqual(screenFromUrl("/modelos/ch-1"), { kind: "template", challengeId: "ch-1" });
  assert.deepEqual(screenFromUrl("/templates/ch-1"), { kind: "template", challengeId: "ch-1" });
  assert.equal(urlForScreen({ kind: "templates" }), "/modelos");
  assert.equal(urlForScreen({ kind: "template", challengeId: "ch 1" }), "/modelos/ch%201");
});

test("toda tela roteável volta de urlForScreen → screenFromUrl com o mesmo tipo", () => {
  const screens = [
    { kind: "dashboard" },
    { kind: "group", groupId: "g1" },
    { kind: "catalog-item", groupId: "g1", itemId: "i1" },
    { kind: "personal-space" },
    { kind: "personal-catalog" },
    { kind: "personal-catalog-item", itemId: "i1" },
    { kind: "personal-trash" },
    { kind: "group-trash", groupId: "g1" },
    { kind: "create-challenge", groupId: "g1" },
    { kind: "create-personal-challenge" },
    { kind: "challenge", challengeId: "c1", tab: "today" },
    { kind: "admin", challengeId: "c1", tab: "metrics" },
    { kind: "templates" },
    { kind: "template", challengeId: "c1" },
    { kind: "about" },
    { kind: "invite", token: "t1" },
  ] as const;
  for (const screen of screens) {
    const url = urlForScreen(screen);
    assert.ok(url, `${screen.kind} tem URL`);
    const [pathname, search = ""] = url!.split("?");
    assert.equal(screenFromUrl(pathname, search ? `?${search}` : "")?.kind, screen.kind, `${url} → ${screen.kind}`);
  }
});

test("todo deep-link tem um page.tsx no disco", async () => {
  const { existsSync } = await import("node:fs");
  const pages = [
    "app/page.tsx", "app/groups/[groupId]/page.tsx", "app/groups/[groupId]/trash/page.tsx",
    "app/groups/[groupId]/catalog/[itemId]/page.tsx", "app/personal/page.tsx", "app/personal/trash/page.tsx",
    "app/catalog/page.tsx", "app/catalog/[itemId]/page.tsx", "app/challenges/[challengeId]/page.tsx",
    "app/challenges/[challengeId]/manage/page.tsx", "app/challenges/new/page.tsx",
    "app/modelos/page.tsx", "app/modelos/[challengeId]/page.tsx", "app/sobre/page.tsx",
    "app/invites/[token]/page.tsx", "app/results/[token]/page.tsx",
  ];
  for (const page of pages) {
    assert.ok(existsSync(new URL(`../${page}`, import.meta.url)), `${page} existe`);
  }
});
