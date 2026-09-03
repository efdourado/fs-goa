import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { bucketize, byRatingDesc, decadeOf, highlights } from "../app/goa/catalog-insights";

const items = [
  { mainGenre: "drama", year: 1994, ratingAvg: 4.5, ratingCount: 2 },
  { mainGenre: "drama", year: 1999, ratingAvg: 3.5, ratingCount: 2 },
  { mainGenre: "sci-fi", year: 2004, ratingAvg: 5, ratingCount: 1 },
  { mainGenre: null, year: null, ratingAvg: null, ratingCount: 0 },
];

describe("catalog insights", () => {
  test("bucketize weights the average by each item's rating count", () => {
    const byGenre = bucketize(items, (item) =>
      item.mainGenre ? { key: item.mainGenre, label: item.mainGenre } : null,
    );
    const drama = byGenre.find((bucket) => bucket.key === "drama")!;
    // (4.5*2 + 3.5*2) / 4 = 4, not (4.5 + 3.5) / 2 which is also 4 here — use skew to prove it
    assert.equal(drama.ratingAvg, 4);
    assert.equal(drama.ratingCount, 4);
    assert.equal(drama.itemCount, 2);
  });

  test("weighting is not a mean of means", () => {
    const skewed = [
      { ratingAvg: 5, ratingCount: 10 },
      { ratingAvg: 1, ratingCount: 2 },
    ];
    const [bucket] = bucketize(skewed, () => ({ key: "x", label: "x" }));
    assert.equal(bucket.ratingAvg, Number(((5 * 10 + 1 * 2) / 12).toFixed(2)));
  });

  test("an all-unrated bucket reports a null average, not zero", () => {
    const [bucket] = bucketize([{ ratingAvg: null, ratingCount: 0 }], () => ({ key: "x", label: "x" }));
    assert.equal(bucket.ratingAvg, null);
    assert.equal(bucket.itemCount, 1);
  });

  test("byRatingDesc ranks rated buckets first", () => {
    const ranked = byRatingDesc(bucketize(items, (item) =>
      item.mainGenre ? { key: item.mainGenre, label: item.mainGenre } : { key: "none", label: "none" },
    ));
    assert.deepEqual(ranked.map((bucket) => bucket.key), ["sci-fi", "drama", "none"]);
  });

  test("highlights keeps only buckets above the rating-count floor", () => {
    const top = highlights(
      bucketize(items, (item) => (item.mainGenre ? { key: item.mainGenre, label: item.mainGenre } : null)),
      3,
    );
    assert.deepEqual(top.map((bucket) => bucket.key), ["drama"]);
  });

  test("decadeOf floors to the decade", () => {
    assert.equal(decadeOf(1994), "1990s");
    assert.equal(decadeOf(2000), "2000s");
  });
});
