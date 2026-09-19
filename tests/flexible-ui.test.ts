import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { bodyFromValues, builtInProperties, propertiesHaveProblem, valuesFromItem } from "../app/goa/property-inputs";
import {
  NO_RECOMMENDER,
  recommenderBody,
  recommenderFromItem,
  sameRecommender,
} from "../app/goa/recommender-picker";
import {
  decodeEventForm,
  emptyEventForm,
  encodeEventForm,
  type EventForm,
  eventFormProblem,
  instantToDateKey,
  instantToWallClock,
  wallClockToInstant,
} from "../app/goa/schedule";
import type { ChallengeDetail, ChallengeField, Entry, EntryTypeView, LibraryProperty } from "../app/goa/types";
import { displayAnswer, isItemDone } from "../app/goa/utils";
import { libraryChoices } from "../app/goa/libraries";

describe("item schedule in the challenge's own time zone", () => {
  test("a wall-clock time round-trips through an instant in São Paulo and in Lisbon", () => {
    for (const zone of ["America/Sao_Paulo", "Europe/Lisbon", "Asia/Tokyo"]) {
      const instant = wallClockToInstant("2026-03-14T20:30", zone);
      assert.ok(instant);
      assert.equal(instantToWallClock(instant, zone), "2026-03-14T20:30");
      assert.equal(instantToDateKey(instant, zone), "2026-03-14");
    }
  });

  test("the same wall-clock time is a different instant in a different zone", () => {
    const saoPaulo = wallClockToInstant("2026-03-14T20:30", "America/Sao_Paulo");
    const tokyo = wallClockToInstant("2026-03-14T20:30", "Asia/Tokyo");
    assert.equal(saoPaulo, "2026-03-14T23:30:00.000Z");
    assert.equal(tokyo, "2026-03-14T11:30:00.000Z");
  });

  test("a bad or blank input is not an instant", () => {
    assert.equal(wallClockToInstant("", "UTC"), null);
    assert.equal(wallClockToInstant("not a date", "UTC"), null);
  });

  test("the day an instant falls on depends on the zone", () => {
    // 23:30 in São Paulo on the 14th is already the 15th in Tokyo.
    assert.equal(instantToDateKey("2026-03-15T02:30:00.000Z", "America/Sao_Paulo"), "2026-03-14");
    assert.equal(instantToDateKey("2026-03-15T02:30:00.000Z", "Asia/Tokyo"), "2026-03-15");
  });
});

describe("recommender values", () => {
  test("a new item sends only what was chosen; an edit blanks the others so the old one is cleared", () => {
    assert.deepEqual(recommenderBody({ kind: "member", userId: "u1" }, "item", false), { recommendedByUserId: "u1" });
    assert.deepEqual(recommenderBody({ kind: "member", userId: "u1" }, "item", true), {
      recommendedByUserId: "u1", recommendedByExternalId: "", originNote: "",
    });
    assert.deepEqual(recommenderBody(NO_RECOMMENDER, "catalog", true), {
      catalogRecommendedByUserId: "", catalogRecommendedByExternalId: "", catalogOriginNote: "",
    });
    assert.deepEqual(recommenderBody(NO_RECOMMENDER, "item", false), {});
  });

  test("a saved outside name and a note use their own keys and never collide", () => {
    assert.deepEqual(recommenderBody({ kind: "external", recommenderId: "r1" }, "catalog", false), { catalogRecommendedByExternalId: "r1" });
    assert.deepEqual(recommenderBody({ kind: "note", text: "  a podcast " }, "item", false), { originNote: "a podcast" });
    // An empty note is nothing, not a blank note.
    assert.deepEqual(recommenderBody({ kind: "note", text: "  " }, "item", false), {});
  });

  test("an existing item's recommender reads back the way it was stored", () => {
    assert.deepEqual(recommenderFromItem({ kind: "member", id: "u1", name: "Ana" }), { kind: "member", userId: "u1" });
    assert.deepEqual(recommenderFromItem({ kind: "external", id: "r1", name: "Bia" }), { kind: "external", recommenderId: "r1" });
    assert.deepEqual(recommenderFromItem(null, "via a blog"), { kind: "note", text: "via a blog" });
    assert.deepEqual(recommenderFromItem(null, "   "), NO_RECOMMENDER);
    assert.ok(sameRecommender({ kind: "note", text: "x " }, { kind: "note", text: "x" }));
    assert.ok(!sameRecommender({ kind: "member", userId: "a" }, { kind: "external", recommenderId: "a" }));
  });
});

describe("library properties as form values", () => {
  const cuisine: LibraryProperty = {
    key: "def1", attributeKey: "cozinha", storage: "attribute", label: "Cuisine", type: "text", hidden: false, position: 10, canHide: true,
  };
  const rating: LibraryProperty = {
    key: "def2", attributeKey: "nota_media", storage: "attribute", label: "Stars", type: "number", hidden: false, position: 11, canHide: true,
  };

  test("a new item leaves blanks out; an edit sends explicit clears", () => {
    const properties = [...builtInProperties("film"), cuisine, rating];
    const values = { year: "1999", main_genre: "", def1: "Thai", def2: "" };
    assert.deepEqual(bodyFromValues(properties, values, "create"), { native: { year: 1999 }, attributes: { cozinha: "Thai" } });
    assert.deepEqual(bodyFromValues(properties, values, "update"), {
      native: { year: 1999, mainGenre: "", runtimeMinutes: null },
      attributes: { cozinha: "Thai", nota_media: "" },
    });
  });

  test("a zero and a false are values, not blanks", () => {
    const flag: LibraryProperty = { ...cuisine, key: "def3", attributeKey: "veg", type: "boolean" };
    const properties = [rating, flag];
    assert.deepEqual(bodyFromValues(properties, { def2: "0", def3: "false" }, "create"), {
      native: {}, attributes: { nota_media: 0, veg: false },
    });
  });

  test("a hidden property is never sent, whatever is left in its field", () => {
    const hidden = { ...cuisine, hidden: true };
    assert.deepEqual(bodyFromValues([hidden], { def1: "Thai" }, "update"), { native: {}, attributes: {} });
  });

  test("an item's saved values fill the form by property, native and custom alike", () => {
    const values = valuesFromItem([...builtInProperties("book"), cuisine], {
      author: "Le Guin", year: 1969, mainGenre: null, pageCount: 304, runtimeMinutes: null,
      attributes: [{ key: "cozinha", label: "Cuisine", type: "text", value: "Thai" }],
    });
    assert.equal(values.author, "Le Guin");
    assert.equal(values.year, "1969");
    assert.equal(values.main_genre, "");
    assert.equal(values.page_count, "304");
    assert.equal(values.def1, "Thai");
  });

  test("a film has no author or pages, a book has no runtime, anything else has only a title", () => {
    assert.deepEqual(builtInProperties("film").map((property) => property.key), ["title", "year", "main_genre", "runtime_minutes", "scheduled_at"]);
    assert.deepEqual(builtInProperties("book").map((property) => property.key), ["title", "author", "year", "main_genre", "page_count", "scheduled_at"]);
    assert.deepEqual(builtInProperties("lib_abc").map((property) => property.key), ["title", "scheduled_at"]);
    // The event date is off until a library switches it on.
    assert.deepEqual(builtInProperties("lib_abc").filter((property) => property.hidden).map((property) => property.key), ["scheduled_at"]);
  });
});

describe("library choices", () => {
  test("built-in Screens and Pages are always offered, even before they exist", () => {
    const choices = libraryChoices([]);
    assert.deepEqual(choices.map((choice) => [choice.kind, choice.id]), [["film", null], ["book", null]]);
  });

  test("a real library replaces its built-in placeholder rather than doubling it", () => {
    const choices = libraryChoices([
      { id: "l1", kind: "film", source: "screens", label: null, position: 0 },
      { id: "l2", kind: "lib_x", source: "custom", label: "Matches", position: 1 },
    ]);
    assert.deepEqual(choices.map((choice) => choice.kind), ["film", "lib_x", "book"]);
    assert.equal(choices.find((choice) => choice.kind === "film")?.id, "l1");
  });
});

describe("Done with shared answers", () => {
  const field = (id: string, required: boolean) => ({ id, key: id, label: id, type: "number" as const, required });
  const types = [
    { id: "t-done", name: "Done", answerScope: "individual", fields: [field("f1", false)] },
    { id: "t-score", name: "Score", answerScope: "shared", fields: [field("f2", true)] },
    { id: "t-note", name: "Note", answerScope: "shared", fields: [field("f3", false)] },
  ] as unknown as EntryTypeView[];
  const challenge = { entryTypes: types, completionEntryTypeId: "t-done" } as Pick<ChallengeDetail, "entryTypes" | "completionEntryTypeId">;
  const mine = { id: "e1", itemId: "i1", entryTypeId: "t-done", userId: "me", values: {} } as Entry;
  const theirs = { id: "e2", itemId: "i1", entryTypeId: "t-done", userId: "them", values: {} } as Entry;
  const score = { id: "e3", itemId: "i1", entryTypeId: "t-score", userId: null, answerScope: "shared", values: {} } as Entry;

  test("an item is not done until the group's required shared answer is in", () => {
    assert.equal(isItemDone(challenge, [mine], "me", "i1"), false);
    assert.equal(isItemDone(challenge, [mine, score], "me", "i1"), true);
  });

  test("someone else's individual answer never counts for you", () => {
    assert.equal(isItemDone(challenge, [theirs, score], "me", "i1"), false);
    assert.equal(isItemDone(challenge, [theirs, score], "them", "i1"), true);
  });

  test("a shared type with no required field never blocks Done", () => {
    const optionalOnly = { ...challenge, entryTypes: [types[0], types[2]] };
    assert.equal(isItemDone(optionalOnly, [mine], "me", "i1"), true);
  });

  test("with no shared answers it is exactly \"you recorded it\"", () => {
    const individual = { entryTypes: [types[0]], completionEntryTypeId: "t-done" } as Pick<ChallengeDetail, "entryTypes" | "completionEntryTypeId">;
    assert.equal(isItemDone(individual, [mine], "me", "i1"), true);
    assert.equal(isItemDone(individual, [theirs], "me", "i1"), false);
    assert.equal(isItemDone(individual, [], "me", "i1"), false);
  });

  test("another item's answers do not leak in", () => {
    assert.equal(isItemDone(challenge, [mine, { ...score, itemId: "i2" }], "me", "i1"), false);
  });
});

describe("showing a saved answer", () => {
  const words = { yes: "Yes", no: "No" };
  test("blank stays blank, but zero and false are shown", () => {
    const number = { id: "f", key: "f", label: "F", type: "number", required: false } as ChallengeField;
    assert.equal(displayAnswer(number, "", words), "");
    assert.equal(displayAnswer(number, null, words), "");
    assert.equal(displayAnswer(number, 0, words), "0");
    assert.equal(displayAnswer({ ...number, type: "boolean" }, false, words), "No");
    assert.equal(displayAnswer({ ...number, type: "boolean" }, true, words), "Yes");
  });

  test("a select shows its option's label and a rating its comma", () => {
    const select = { id: "s", key: "s", label: "S", type: "select", required: false, config: { options: [{ id: "o1", label: "Win" }] } } as ChallengeField;
    assert.equal(displayAnswer(select, "o1", words), "Win");
    assert.equal(displayAnswer({ ...select, type: "rating" }, 3.5, words), "3,5");
  });
});

describe("an item's own date in property forms", () => {
  const zone = "America/Sao_Paulo";
  const scheduleOn: LibraryProperty = { ...builtInProperties("lib_abc").find((property) => property.type === "schedule")!, hidden: false };
  const form = (patch: Partial<EventForm>): EventForm => ({ ...emptyEventForm(zone), ...patch });
  const encoded = (patch: Partial<EventForm>) => encodeEventForm(form(patch), zone);

  test("the built-in date is a hidden native property until a library switches it on", () => {
    const [, hiddenSchedule] = builtInProperties("lib_abc");
    assert.equal(hiddenSchedule.hidden, true);
    assert.deepEqual(bodyFromValues([hiddenSchedule], { scheduled_at: encoded({ date: "2026-06-15" }) }, "update"), { native: {}, attributes: {} });
  });

  test("just a date is a day; an end date makes it a range", () => {
    assert.deepEqual(bodyFromValues([scheduleOn], { scheduled_at: encoded({ date: "2026-06-20" }) }, "create").native, {
      scheduledAt: { startsOn: "2026-06-20", timeZone: zone },
    });
    assert.deepEqual(bodyFromValues([scheduleOn], { scheduled_at: encoded({ date: "2026-06-20", endDate: "2026-06-22" }) }, "create").native, {
      scheduledAt: { startsOn: "2026-06-20", endsOn: "2026-06-22", timeZone: zone },
    });
  });

  test("switching the time on turns it into an instant in the chosen zone, with an optional end", () => {
    const timed = encoded({ date: "2026-06-15", withTime: true, time: "16:00", endTime: "18:00" });
    assert.deepEqual(bodyFromValues([scheduleOn], { scheduled_at: timed }, "create").native, {
      scheduledAt: { startsAt: "2026-06-15T19:00:00.000Z", endsAt: "2026-06-15T21:00:00.000Z", timeZone: zone },
    });
    const overnight = encoded({ date: "2026-06-15", withTime: true, time: "22:00", endDate: "2026-06-16", endTime: "01:00" });
    assert.deepEqual(bodyFromValues([scheduleOn], { scheduled_at: overnight }, "create").native, {
      scheduledAt: { startsAt: "2026-06-16T01:00:00.000Z", endsAt: "2026-06-16T04:00:00.000Z", timeZone: zone },
    });
    // switching the time back off keeps the day and drops the clock
    const off = encoded({ date: "2026-06-15", withTime: false, time: "16:00", endTime: "18:00" });
    assert.deepEqual(bodyFromValues([scheduleOn], { scheduled_at: off }, "create").native, { scheduledAt: { startsOn: "2026-06-15", timeZone: zone } });
  });

  test("a new item with no date sends nothing; an edit that emptied it says null", () => {
    assert.deepEqual(bodyFromValues([scheduleOn], { scheduled_at: "" }, "create").native, {});
    assert.deepEqual(bodyFromValues([scheduleOn], { scheduled_at: "" }, "update").native, { scheduledAt: null });
  });

  test("a saved date fills the form back, in the zone it was entered in", () => {
    const timed = valuesFromItem([scheduleOn], {
      scheduledAt: { startsAt: "2026-06-15T19:00:00.000Z", endsAt: "2026-06-15T21:00:00.000Z", precision: "datetime", timeZone: zone },
    }, "UTC");
    assert.deepEqual(decodeEventForm(timed.scheduled_at, "UTC"), { date: "2026-06-15", endDate: "", withTime: true, time: "16:00", endTime: "18:00", timeZone: zone });
    const range = valuesFromItem([scheduleOn], {
      scheduledAt: { startsAt: "2026-06-20T03:00:00.000Z", endsAt: "2026-06-22T03:00:00.000Z", precision: "date", timeZone: zone },
    }, "UTC");
    assert.deepEqual(decodeEventForm(range.scheduled_at, "UTC"), { date: "2026-06-20", endDate: "2026-06-22", withTime: false, time: "", endTime: "", timeZone: zone });
    assert.equal(valuesFromItem([scheduleOn], { scheduledAt: null }, zone).scheduled_at, "");
  });

  test("a zone picked before the date isn't lost, and a problem blocks saving", () => {
    const zoneOnly = encoded({ timeZone: "Europe/Lisbon" });
    assert.equal(decodeEventForm(zoneOnly, zone).timeZone, "Europe/Lisbon");
    assert.equal(encoded({}), "");
    const badZone = encoded({ date: "2026-06-15", withTime: true, time: "16:00", timeZone: "Nowhere/Land" });
    const backwards = encoded({ date: "2026-06-15", withTime: true, time: "16:00", endTime: "15:00" });
    const noTime = encoded({ date: "2026-06-15", withTime: true });
    const endBeforeStart = encoded({ date: "2026-06-15", endDate: "2026-06-14" });
    for (const bad of [badZone, backwards, noTime, endBeforeStart]) assert.equal(propertiesHaveProblem([scheduleOn], { scheduled_at: bad }), true);
    assert.equal(propertiesHaveProblem([scheduleOn], { scheduled_at: "" }), false);
    assert.equal(propertiesHaveProblem([scheduleOn], { scheduled_at: encoded({ date: "2026-06-15", endDate: "2026-06-15" }) }), false, "a one-day range is fine");
    // a half-typed zone is a problem, never a crash — and the zone doesn't matter while the time is off
    assert.doesNotThrow(() => bodyFromValues([scheduleOn], { scheduled_at: badZone }, "create"));
    assert.deepEqual(bodyFromValues([scheduleOn], { scheduled_at: badZone }, "create").native, {});
    assert.equal(eventFormProblem(form({ date: "2026-06-15", timeZone: "Nowhere/Land" })), null);
  });
});
