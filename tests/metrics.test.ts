import assert from "node:assert/strict";
import test from "node:test";
import { calculateMetric } from "../lib/metrics";

test("calcula as seis métricas básicas com semântica determinística", () => {
  const values = [1, 2, 4.5];
  assert.deepEqual(calculateMetric({ operation: "sum", values }), { value: 7.5, sampleSize: 3 });
  assert.deepEqual(calculateMetric({ operation: "average", values }), { value: 2.5, sampleSize: 3 });
  assert.deepEqual(calculateMetric({ operation: "count", values }), { value: 3, sampleSize: 3 });
  assert.deepEqual(calculateMetric({ operation: "min", values }), { value: 1, sampleSize: 3 });
  assert.deepEqual(calculateMetric({ operation: "max", values }), { value: 4.5, sampleSize: 3 });
  assert.deepEqual(calculateMetric({ operation: "completion_rate", completed: 3, expected: 4 }), {
    value: 75,
    sampleSize: 3,
  });
});

test("define casos vazios e não altera a entrada", () => {
  const values = Object.freeze([] as number[]);
  assert.deepEqual(calculateMetric({ operation: "sum", values }), { value: 0, sampleSize: 0 });
  assert.deepEqual(calculateMetric({ operation: "count", values }), { value: 0, sampleSize: 0 });
  assert.deepEqual(calculateMetric({ operation: "average", values }), { value: null, sampleSize: 0 });
  assert.deepEqual(calculateMetric({ operation: "min", values }), { value: null, sampleSize: 0 });
  assert.deepEqual(calculateMetric({ operation: "max", values }), { value: null, sampleSize: 0 });
  assert.deepEqual(calculateMetric({ operation: "completion_rate", completed: 0, expected: 0 }), {
    value: 0,
    sampleSize: 0,
  });
});

test("rejeita números não finitos", () => {
  assert.throws(() => calculateMetric({ operation: "sum", values: [Number.NaN] }), /finitos/);
  assert.throws(() => calculateMetric({ operation: "max", values: [Number.POSITIVE_INFINITY] }), /finitos/);
});

