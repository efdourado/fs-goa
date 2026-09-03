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
  assert.deepEqual(screenFromUrl("/challenges/ch-1", "?tab=history"), {
    kind: "challenge",
    challengeId: "ch-1",
    tab: "history",
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
