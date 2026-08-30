import assert from "node:assert/strict";
import test from "node:test";

import { inviteTokenFromText } from "../app/goa/utils";

test("extrai token de convite sem depender de window", () => {
  assert.equal(inviteTokenFromText(" token_bruto-123 "), "token_bruto-123");
  assert.equal(inviteTokenFromText("/?invite=token_query-123"), "token_query-123");
  assert.equal(inviteTokenFromText("?invite=token_relativo-123"), "token_relativo-123");
  assert.equal(
    inviteTokenFromText("https://goa.example/?invite=token%5Fcodificado-123"),
    "token_codificado-123",
  );
});

test("aceita rotas singular e plural de convite", () => {
  assert.equal(inviteTokenFromText("/invite/token-singular_123"), "token-singular_123");
  assert.equal(inviteTokenFromText("https://goa.example/invites/token-plural_123"), "token-plural_123");
  assert.equal(inviteTokenFromText("/invites/token%5Fescapado-123"), "token_escapado-123");
  assert.equal(inviteTokenFromText("   "), "");
});
