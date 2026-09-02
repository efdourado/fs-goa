import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ApiError } from "../lib/http";
import {
  isLegacyRecipeKey,
  isRecipeKey,
  recipeRequiresPeriod,
  resolveRecipe,
} from "../lib/goa/challenges/recipes";

function assertInvalidRecipe(recipe: unknown): void {
  assert.throws(
    () => resolveRecipe({ recipe }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.equal(error.code, "invalid_recipe");
      return true;
    },
  );
}

describe("current challenge recipes", () => {
  test("Cinema is a period-bound film rating recipe", () => {
    const recipe = resolveRecipe({ recipe: "cinema" });

    assert.equal(recipe.key, "cinema");
    assert.equal(recipe.catalogKind, "film");
    assert.equal(recipe.scheduleMode, "period");
    assert.deepEqual(recipe.entryTypes.map((type) => type.purpose), ["rating"]);
    assert.deepEqual(recipe.entryTypes[0].fields.map((field) => field.key), ["nota", "comentario"]);
  });

  test("Library records daily pages and a separate book completion", () => {
    const recipe = resolveRecipe({ recipe: "library" });

    assert.equal(recipe.key, "library");
    assert.equal(recipe.catalogKind, "book");
    assert.equal(recipe.scheduleMode, "period");
    assert.deepEqual(recipe.entryTypes.map((type) => type.purpose), ["progress", "completion"]);
    assert.equal(recipe.entryTypes[0].cardinality, "once_per_item_day");
    assert.equal(recipe.entryTypes[1].cardinality, "once_per_item");
  });

  test("legacy keys remain identifiable but cannot seed a new challenge", () => {
    for (const key of ["cine_free", "cine_curated", "reading_club", "reading_daily"] as const) {
      assert.equal(isLegacyRecipeKey(key), true);
      assert.equal(isRecipeKey(key), false);
      assertInvalidRecipe(key);
    }
  });

  test("old template aliases resolve only to the consolidated recipes", () => {
    assert.equal(resolveRecipe({ template: "cine" }).key, "cinema");
    assert.equal(resolveRecipe({ template: "reading" }).key, "library");
  });

  test("only the consolidated recipes require a period", () => {
    assert.equal(recipeRequiresPeriod("cinema"), true);
    assert.equal(recipeRequiresPeriod("library"), true);
    assert.equal(recipeRequiresPeriod("cine_free"), false);
    assert.equal(recipeRequiresPeriod("reading_club"), false);
    assert.equal(recipeRequiresPeriod(null), false);
  });
});
