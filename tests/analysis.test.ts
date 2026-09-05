import assert from "node:assert/strict";
import test from "node:test";

import {
  bayesianAverage,
  compositeAffinity,
  consensus,
  directAffinity,
  indicatorBias,
  mean,
  meanDelta,
  median,
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

test("desvio e consenso descrevem concordância (consenso em 0–100)", () => {
  assert.deepEqual(spread([4, 4, 4]), { value: 0, sampleSize: 3 });
  assert.deepEqual(consensus([4, 4, 4], 5), { value: 100, sampleSize: 3 });
  // notas 1 e 5 num range 5 → stdev 2, consenso (1 − 2/2.5) × 100 = 20
  assert.deepEqual(spread([1, 5]), { value: 2, sampleSize: 2 });
  assert.deepEqual(consensus([1, 5], 5), { value: 20, sampleSize: 2 });
});

test("meanDelta mede surpresa (avaliação − expectativa)", () => {
  assert.deepEqual(meanDelta([[5, 3], [4, 4], [2, 5]]), { value: -0.33, sampleSize: 3 });
  assert.deepEqual(meanDelta([[4, 2], [5, 3]]), { value: 2, sampleSize: 2 });
});

test("viés do indicador compara as indicações da pessoa com o grupo", () => {
  assert.deepEqual(indicatorBias([4, 5], 3.5), { value: 1, sampleSize: 2 });
  assert.deepEqual(indicatorBias([2], 3.5), { value: -1.5, sampleSize: 1 });
});

test("mediana: valor central, e média dos dois centrais em contagem par", () => {
  assert.deepEqual(median([3, 1, 2]), { value: 2, sampleSize: 3 });
  assert.deepEqual(median([1, 2, 3, 4]), { value: 2.5, sampleSize: 4 });
  assert.deepEqual(median([5]), { value: 5, sampleSize: 1 });
  assert.deepEqual(median([]), { value: null, sampleSize: 0 });
});

test("afinidade direta: 100 × (1 − média das diferenças / amplitude), nunca com 1–2 itens", () => {
  // diffs |a−b| = [0, 1, 0, 2, 1] → média 0,8 ; amplitude 5 → 100 × (1 − 0,16) = 84
  assert.deepEqual(directAffinity([[5, 5], [4, 3], [2, 2], [5, 3], [1, 2]], 5), { value: 84, sampleSize: 5 });
  // por padrão exige 5 itens em comum (recomendado); 4 ainda fica abaixo
  assert.deepEqual(directAffinity([[5, 5], [4, 4], [3, 3], [2, 2]], 5), { value: null, sampleSize: 4 });
  // com minSample: 3 (piso duro), 3 idênticas → 100
  assert.deepEqual(directAffinity([[4, 4], [3, 3], [5, 5]], 5, { minSample: 3 }), { value: 100, sampleSize: 3 });
  // o piso duro em 3 vale mesmo pedindo menos — 2 itens nunca calculam
  assert.deepEqual(directAffinity([[5, 5], [4, 4]], 5, { minSample: 1 }), { value: null, sampleSize: 2 });
});

test("afinidade composta: mistura ponderada, redistribui o peso das dimensões sem amostra", () => {
  const full = compositeAffinity([
    { key: "items", value: 80, sampleSize: 8, weight: 0.5 },
    { key: "genre", value: 60, sampleSize: 5, weight: 0.25 },
    { key: "year_band", value: 40, sampleSize: 4, weight: 0.15 },
    { key: "duration", value: 100, sampleSize: 3, weight: 0.1 },
  ]);
  // 80·0.5 + 60·0.25 + 40·0.15 + 100·0.1 = 40 + 15 + 6 + 10 = 71
  assert.equal(full.value, 71);
  assert.equal(full.skipped.length, 0);

  // gênero e duração sem amostra → seus pesos (0.35) vão para items+ano na proporção 0.5:0.15
  const partial = compositeAffinity([
    { key: "items", value: 80, sampleSize: 8, weight: 0.5 },
    { key: "genre", value: null, sampleSize: 1, weight: 0.25 },
    { key: "year_band", value: 40, sampleSize: 6, weight: 0.15 },
    { key: "duration", value: null, sampleSize: 0, weight: 0.1 },
  ]);
  assert.deepEqual(partial.skipped.sort(), ["duration", "genre"]);
  // pesos renormalizados: items 0.5/0.65 ≈ 0.7692, ano 0.15/0.65 ≈ 0.2308
  // 80·0.7692 + 40·0.2308 ≈ 70.77 → 71
  assert.equal(partial.value, 71);

  assert.equal(compositeAffinity([{ key: "items", value: null, sampleSize: 1, weight: 0.5 }]).value, null);
});

test("casos vazios e entradas inválidas", () => {
  assert.equal(mean([]), null);
  assert.deepEqual(bayesianAverage([], 3.5, 4), { value: null, sampleSize: 0 });
  assert.deepEqual(meanDelta([]), { value: null, sampleSize: 0 });
  assert.throws(() => spread([Number.NaN]), /finitos/);
  assert.throws(() => bayesianAverage([1], Number.POSITIVE_INFINITY, 4), /finitos/);
  assert.throws(() => median([Number.NaN]), /finitos/);
  assert.throws(() => directAffinity([[Number.NaN, 1], [2, 3], [4, 5]], 5), /finitos/);
});
