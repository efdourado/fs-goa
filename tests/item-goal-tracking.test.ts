import assert from "node:assert/strict";
import { test } from "node:test";
import { isItemGoalTrackingType, ITEM_GOAL_TRACKING_KEY } from "../lib/item-goal-tracking";

test("goal controls only own the supplementary goal log, never exercise or primary progress fields", () => {
  const goal = { semanticKey: ITEM_GOAL_TRACKING_KEY, purpose: "progress", parentTypeId: null, isPrimary: false };
  assert.equal(isItemGoalTrackingType(goal), true);
  assert.equal(isItemGoalTrackingType({ ...goal, parentTypeId: "day" }), false);
  assert.equal(isItemGoalTrackingType({ ...goal, isPrimary: true }), false);
  assert.equal(isItemGoalTrackingType({ ...goal, semanticKey: "desempenho" }), false);
  assert.equal(isItemGoalTrackingType({ ...goal, semanticKey: "progresso" }), false);
  assert.equal(isItemGoalTrackingType({ ...goal, purpose: "rating" }), false);
});
