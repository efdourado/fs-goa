import assert from "node:assert/strict";
import test from "node:test";

import {
  bayesianAverage,
  consensus,
  indicatorBias,
  mean,
  meanDelta,
  spread,
} from "../lib/goa/analysis";

test("média bayesiana encolhe amostra pequena em direção ao prior", () => {
  // 2 notas 5, prior 3.5 com peso 4 → (4·3.5 + 10) / (4 + 2) = 4
  assert.deepEqual(bayesianAverage([5, 5], 3.5, 4), { value: 4, sampleSize: 2 });
  // amostra grande domina o prior
  const many = Array.from({ length: 40 }, () => 5);
  assert.equal(bayesianAverage(many, 3.5, 4).value, 4.86);
  // peso 0 = média simples
  assert.deepEqual(bayesianAverage([2, 4], 3.5, 0), { value: 3, sampleSize: 2 });
});

test("piso de amostra zera o valor mas preserva sampleSize", () => {
  assert.deepEqual(bayesianAverage([5], 3.5, 4, { minSample: 4 }), { value: null, sampleSize: 1 });
  assert.deepEqual(spread([5], { minSample: 2 }), { value: null, sampleSize: 1 });
  assert.deepEqual(meanDelta([[5, 3]], { minSample: 2 }), { value: null, sampleSize: 1 });
});

test("desvio e consenso descrevem concordância", () => {
  assert.deepEqual(spread([4, 4, 4]), { value: 0, sampleSize: 3 });
  assert.deepEqual(consensus([4, 4, 4], 5), { value: 1, sampleSize: 3 });
  // notas 1 e 5 num range 5 → stdev 2, consenso 1 − 2/2.5 = 0.2
  assert.deepEqual(spread([1, 5]), { value: 2, sampleSize: 2 });
  assert.deepEqual(consensus([1, 5], 5), { value: 0.2, sampleSize: 2 });
});

test("meanDelta mede surpresa (avaliação − expectativa)", () => {
  assert.deepEqual(meanDelta([[5, 3], [4, 4], [2, 5]]), { value: -0.33, sampleSize: 3 });
  assert.deepEqual(meanDelta([[4, 2], [5, 3]]), { value: 2, sampleSize: 2 });
});

test("viés do indicador compara as indicações da pessoa com o grupo", () => {
  assert.deepEqual(indicatorBias([4, 5], 3.5), { value: 1, sampleSize: 2 });
  assert.deepEqual(indicatorBias([2], 3.5), { value: -1.5, sampleSize: 1 });
});

test("casos vazios e entradas inválidas", () => {
  assert.equal(mean([]), null);
  assert.deepEqual(bayesianAverage([], 3.5, 4), { value: null, sampleSize: 0 });
  assert.deepEqual(meanDelta([]), { value: null, sampleSize: 0 });
  assert.throws(() => spread([Number.NaN]), /finitos/);
  assert.throws(() => bayesianAverage([1], Number.POSITIVE_INFINITY, 4), /finitos/);
});
