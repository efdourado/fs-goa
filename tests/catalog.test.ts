import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTitle } from "../lib/goa/catalog";

test("normalizeTitle colapsa espaços, tira acento e caixa para casar grafias", () => {
  assert.equal(normalizeTitle("  Cidade   de Deus "), "cidade de deus");
  assert.equal(normalizeTitle("Amélie"), normalizeTitle("Amelie"));
  assert.equal(normalizeTitle("AFTERSUN"), normalizeTitle("aftersun"));
  assert.notEqual(normalizeTitle("Aftersun"), normalizeTitle("After Sun"));
});
