import assert from "node:assert/strict";
import test from "node:test";

import { COVER_TONES, coverToneOf } from "../app/goa/catalog-cover";
import { decadeOf, groupCatalogItems } from "../app/goa/catalog-views";

test("a title always gets the same cover colour, and the same title in any case or spacing agrees", () => {
  assert.equal(coverToneOf("Solaris"), coverToneOf("  SOLARIS "));
  assert.ok(COVER_TONES.includes(coverToneOf("Aftersun")));
  const seen = new Set(["Aftersun", "Solaris", "Stalker", "Burning", "Past Lives", "Perfect Days", "Drive My Car", "Paris, Texas"].map(coverToneOf));
  assert.ok(seen.size >= 3, "different titles spread across the palette");
});

test("grouping keeps the sort inside each section, orders sections, and sends items without the field last", () => {
  const items = [
    { t: "a", year: 2021, mainGenre: "Drama" },
    { t: "b", year: 1979, mainGenre: "sci-fi" },
    { t: "c", year: 2023, mainGenre: "Drama" },
    { t: "d", year: null, mainGenre: null },
    { t: "e", year: 1972, mainGenre: "Sci-fi" },
  ];
  const ids = (groups: ReturnType<typeof groupCatalogItems<(typeof items)[number]>>) => groups.map((group) => [group.label, group.items.map((item) => item.t).join("")]);
  assert.deepEqual(ids(groupCatalogItems(items, "none")), [["", "abcde"]]);
  assert.deepEqual(ids(groupCatalogItems(items, "genre")), [["Drama", "ac"], ["sci-fi", "be"], ["", "d"]], "genres A→Z, matched without regard to case");
  assert.deepEqual(ids(groupCatalogItems(items, "decade")), [["2020s", "ac"], ["1970s", "be"], ["", "d"]], "decades newest first");
  assert.deepEqual(ids(groupCatalogItems(items, "year")), [["2023", "c"], ["2021", "a"], ["1979", "b"], ["1972", "e"], ["", "d"]]);
});

test("decadeOf floors a year to its decade", () => {
  assert.equal(decadeOf(1994), "1990s");
  assert.equal(decadeOf(2000), "2000s");
});
