import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";

import { resultForChallenge } from "../lib/goa/challenges/results";
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

test("reaproveita métricas calculadas no detalhe sem consultá-las novamente", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes("SELECT results_published_at")) {
        return { rows: [{ results_published_at: null }] };
      }
      if (sql.includes("FROM result_blocks")) {
        return {
          rows: [{
            id: "block-1",
            kind: "metric",
            metric_id: "metric-1",
            heading: "Média",
            body_snapshot: null,
            value_snapshot: null,
            position: 0,
            visible: true,
          }],
        };
      }
      // Total records for the Wrapped cover — 0 entries means no live-ranking pass.
      if (sql.includes("SELECT count(*)::int AS count FROM entries")) {
        return { rows: [{ count: 0 }] };
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  } as unknown as PoolClient;
  const metric = { id: "metric-1", label: "Média", value: 4.5 };

  const result = await resultForChallenge(client, "challenge-1", [metric]);

  assert.deepEqual(result.metrics, [metric]);
  assert.equal(queries.length, 3);
  assert.ok(queries.every((sql) => !sql.includes("FROM challenge_metrics")));
});
