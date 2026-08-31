import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLabel, normalizeTitle } from "../lib/goa/catalog";

test("normalizeTitle colapsa espaços, tira acento e caixa para casar grafias", () => {
  assert.equal(normalizeTitle("  Cidade   de Deus "), "cidade de deus");
  assert.equal(normalizeTitle("Amélie"), normalizeTitle("Amelie"));
  assert.equal(normalizeTitle("AFTERSUN"), normalizeTitle("aftersun"));
  assert.notEqual(normalizeTitle("Aftersun"), normalizeTitle("After Sun"));
});

test("normalizeLabel limita a 80 caracteres", () => {
  assert.equal(normalizeLabel("Ficção Científica"), "ficcao cientifica");
  assert.ok(normalizeLabel("x".repeat(200)).length <= 80);
});
