import assert from "node:assert/strict";
import test from "node:test";

import { hasSyntheticMarker, splitSyntheticMarker, stripSyntheticMarker, SYNTHETIC_MARKER } from "../lib/goa/synthetic";

test("detecta e remove o marcador do seed, preservando o texto visível", () => {
  const description = `Grupo de demonstração. ${SYNTHETIC_MARKER}`;
  assert.equal(hasSyntheticMarker(description), true);
  assert.equal(stripSyntheticMarker(description), "Grupo de demonstração.");
  assert.deepEqual(splitSyntheticMarker(description), {
    visible: "Grupo de demonstração.",
    marker: SYNTHETIC_MARKER,
  });
});

test("descrição sem marcador passa intacta", () => {
  assert.equal(hasSyntheticMarker("Um clube qualquer"), false);
  assert.equal(stripSyntheticMarker("Um clube qualquer"), "Um clube qualquer");
  assert.deepEqual(splitSyntheticMarker("Um clube qualquer"), { visible: "Um clube qualquer", marker: null });
  assert.deepEqual(splitSyntheticMarker(null), { visible: "", marker: null });
});
