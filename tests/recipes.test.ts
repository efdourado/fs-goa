import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ApiError } from "../lib/http";
import {
  isLegacyRecipeKey,
  isRecipeKey,
  recipeCollectsEntryDate,
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
  test("Cinema is a film rating recipe", () => {
    const recipe = resolveRecipe({ recipe: "cinema" });

    assert.equal(recipe.key, "cinema");
    assert.equal(recipe.catalogKind, "film");
    assert.deepEqual(recipe.entryTypes.map((type) => type.purpose), ["rating"]);
    assert.deepEqual(recipe.entryTypes[0].fields.map((field) => field.key), ["nota", "comentario"]);
  });

  test("Library records daily pages and a separate book completion", () => {
    const recipe = resolveRecipe({ recipe: "library" });

    assert.equal(recipe.key, "library");
    assert.equal(recipe.catalogKind, "book");
    assert.deepEqual(recipe.entryTypes.map((type) => type.purpose), ["progress", "completion"]);
    assert.equal(recipe.entryTypes[0].cardinality, "once_per_item_day");
    assert.equal(recipe.entryTypes[1].cardinality, "once_per_item");
  });

  test("Bookshelf rates a list of books with no pages, period, or entry date", () => {
    const recipe = resolveRecipe({ recipe: "bookshelf" });

    assert.equal(recipe.key, "bookshelf");
    assert.equal(recipe.catalogKind, "book");
    assert.equal(recipe.scheduleMode, "none");
    assert.equal(recipe.collectsEntryDate, false);
    assert.equal(recipeCollectsEntryDate("bookshelf"), false);
    assert.equal(recipeCollectsEntryDate("cinema"), true);
    assert.equal(recipeCollectsEntryDate(null), true);
    assert.deepEqual(recipe.entryTypes.map((type) => type.purpose), ["rating"]);
    assert.deepEqual(recipe.entryTypes[0].fields.map((field) => field.key), ["nota", "comentario"]);
    assert.equal(recipe.metrics.some((metric) => metric.fieldKey === "paginas"), false);
    assert.equal(recipe.metrics.some((metric) => metric.needsGroup), true);
  });

  test("Habit has no catalog and no preset numeric field — a blank daily check-in", () => {
    const recipe = resolveRecipe({ recipe: "habit" });

    assert.equal(recipe.key, "habit");
    assert.equal(recipe.catalogKind, null);
    assert.deepEqual(recipe.entryTypes.map((type) => type.purpose), ["checkin"]);
    assert.equal(recipe.entryTypes[0].submissionMode, "daily");
    assert.equal(recipe.entryTypes[0].targetPolicy, "none");
    assert.equal(recipe.entryTypes[0].cardinality, "once_per_day");
    assert.deepEqual(recipe.entryTypes[0].fields.map((field) => field.key), ["nota_dia"]);
    // Nothing numeric is seeded — the whole point is that the person building it
    // adds their own field and their own metric on top of it.
    assert.deepEqual(recipe.metrics.map((metric) => metric.operation), ["completion_rate"]);
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
    assert.equal(resolveRecipe({ template: "estante" }).key, "bookshelf");
  });

  test("scheduleMode is only the wizard's initial toggle, not a hard rule", () => {
    // Cinema opens undated (a watchlist), Library opens dated (a club season) —
    // but the create/activate paths accept either with or without a period.
    assert.equal(resolveRecipe({ recipe: "cinema" }).scheduleMode, "none");
    assert.equal(resolveRecipe({ recipe: "library" }).scheduleMode, "period");
  });
});
