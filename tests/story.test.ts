import assert from "node:assert/strict";
import test from "node:test";

import { demoFilmInput, demoReadingInput } from "../scripts/seed-showcase/data";
import { buildStory, type DatedStory, type RatedStory, type StoryInput } from "../app/goa/story/model";

const TODAY = "2026-09-29";
const films = demoFilmInput("Movie club", (key) => `comment ${key} — long enough to be quoted`, TODAY);

test("a rated club: the drawing's pinned notes and the almanac say what the data backs", () => {
  const story = buildStory(films) as RatedStory;
  assert.equal(story.kind, "rated");
  assert.equal(story.stations.length, 8);
  assert.equal(story.threads.length, 5);
  const note = (kind: string) => story.notes.find((row) => row.kind === kind);
  assert.equal(note("favourite")?.itemId, "past-lives");
  assert.equal(note("split")?.itemId, "tar");
  assert.equal(note("surprise")?.itemId, "barbie");
  assert.equal(note("flop")?.itemId, "megalopolis");
  assert.equal((note("loner") as { personId: string }).personId, "caio");
  assert.deepEqual(story.ranking.slice(0, 3).map((row) => row.item.title), ["Past Lives", "Barbie", "Dune: Part Two"]);
  assert.equal(story.genres[0].key, "Drama", "a genre needs two titles to win");
  assert.deepEqual(story.years.map((row) => row.key), ["2016", "2022", "2023", "2024"]);
  assert.equal(story.properties[0].best.key, "Denis Villeneuve", "the director with two titles");
  assert.equal(story.length?.longest.item.title, "Dune: Part Two");
  assert.equal(story.critics[0].person.name, "Caio", "toughest critic first");
  assert.deepEqual([story.pairs[0].a.name, story.pairs[0].b.name], ["Ana", "Lucas"]);
  assert.deepEqual([story.commonGround[0].a.name, story.commonGround[0].b.name, story.commonGround[0].genre], ["Caio", "Lucas", "Comedy"], "common ground: the pair that disagrees most still meets somewhere");
  assert.ok(story.commonGround.every((row) => row.agreement < 80), "never between people who already agree");
  assert.equal(story.surprises[0].item.title, "Barbie");
  assert.ok(story.totals.minutes! > 1000);
});

test("nothing is invented: agreement, no expectations, no metadata", () => {
  const flat: StoryInput = {
    ...films,
    items: films.items.map((item) => ({ id: item.id, title: item.title })),
    ratings: films.ratings.map((rating) => ({ ...rating, value: 4, comment: null })),
    expectations: [],
  };
  const story = buildStory(flat) as RatedStory;
  assert.equal(story.mood, "sync");
  assert.deepEqual(story.notes.map((row) => row.kind), ["favourite"], "no split, surprise, flop or quote to pin");
  assert.deepEqual([story.genres, story.years, story.properties, story.surprises, story.quotes], [[], [], [], [], []]);
  assert.equal(story.length, null);

  const solo = buildStory({ ...films, people: films.people.slice(0, 1) }) as RatedStory;
  assert.deepEqual([solo.critics, solo.pairs, solo.commonGround], [[], [], []], "one person has no one to compare with");
  assert.equal(buildStory({ ...films, ratings: [] }).kind, "empty");
});

test("a dated habit: lanes, streaks, comebacks, weekdays and totals", () => {
  const story = buildStory(demoReadingInput("Reading", (key) => `note ${key} — long enough to show`, TODAY)) as DatedStory;
  assert.equal(story.kind, "dated");
  assert.equal(story.lanes.length, 4);
  const lane = (id: string) => story.lanes.find((row) => row.person.id === id)!;
  assert.ok(lane("duda").longest!.length >= 21, "Duda's long run");
  assert.equal(lane("ana").comeback?.gap, 8, "Ana stopped for eight days");
  assert.ok(lane("duda").best!.value > 50, "Duda's best day");
  assert.ok((lane("bruno").consistency ?? 0) < 40, "Bruno only reads on weekends");
  assert.equal(story.totals.days, 30);
  assert.ok(story.totals.total! > 1000);
  assert.equal(story.weekdays.length, 7);
  assert.ok(story.bestWeekdays.includes(0) && story.bestWeekdays.includes(6), "weekends stand out (Bruno)");
  assert.ok(story.notes.length >= 1);
});

test("workout records: where each exercise started and the best it reached", () => {
  const input: StoryInput = {
    ...films, ratings: [], expectations: [], items: [{ id: "squat", title: "Squat" }, { id: "bench", title: "Bench" }],
    days: [{ personId: "ana", day: "2026-09-01" }, { personId: "ana", day: "2026-09-08" }, { personId: "ana", day: "2026-09-15" }],
    records: [
      { personId: "ana", itemId: "squat", day: "2026-09-01", value: 60 },
      { personId: "ana", itemId: "squat", day: "2026-09-08", value: 65 },
      { personId: "ana", itemId: "squat", day: "2026-09-15", value: 70 },
      { personId: "ana", itemId: "bench", day: "2026-09-01", value: 40 },
      { personId: "ana", itemId: "bench", day: "2026-09-15", value: 40 },
    ],
  };
  const story = buildStory(input) as DatedStory;
  assert.deepEqual(story.records.map((row) => [row.item.title, row.first, row.best]), [["Squat", 60, 70]], "no record without progress");
});

test("two people read as a mix: where they met, what each brought, the favourite and the argument", () => {
  const duoInput: StoryInput = {
    ...films,
    people: films.people.filter((person) => person.id === "ana" || person.id === "caio"),
    ratings: films.ratings.filter((rating) => rating.personId === "ana" || rating.personId === "caio"),
    expectations: [],
  };
  const story = buildStory(duoInput) as RatedStory;
  const duo = story.duo!;
  assert.deepEqual([duo.a.name, duo.b.name], ["Ana", "Caio"]);
  assert.equal(duo.met.length + duo.aBrought.length + duo.bBrought.length <= 8, true);
  assert.ok(duo.aBrought.some((row) => row.item.title === "Tár"), "Ana brought Tár (5 against 1)");
  assert.ok(duo.bBrought.some((row) => row.item.title === "Arrival" || row.item.title === "Dune: Part Two"), "Caio brought the sci-fi");
  assert.equal(duo.argument?.item.title, "Tár");
  assert.equal(duo.sharedFavourite?.item.title, "Barbie", "the one they both loved: 4.5 and 4.5");
  assert.ok(duo.leanings.find((row) => row.genre === "Drama")!.a > duo.leanings.find((row) => row.genre === "Drama")!.b, "Ana leans drama");
  assert.equal(story.solo, null);
});

test("one person reads as a taste: the scale they use, their perfect scores, their instincts", () => {
  const soloInput: StoryInput = {
    ...films,
    people: films.people.slice(0, 1),
    ratings: films.ratings.filter((rating) => rating.personId === "ana"),
    expectations: films.expectations.filter((row) => row.personId === "ana"),
  };
  const story = buildStory(soloInput) as RatedStory;
  const solo = story.solo!;
  assert.equal(story.duo, null);
  assert.equal(solo.distribution.reduce((sum, row) => sum + row.count, 0), 8);
  assert.equal(solo.distribution.length, 11, "0 to 5 in half points");
  assert.deepEqual(solo.perfect.map((row) => row.item.title).sort(), ["Past Lives", "Tár"]);
  assert.equal(solo.lowest?.item.title, "Megalopolis");
  assert.equal(solo.instincts?.total, 3);
});

test("two people's days: how often they showed up together", () => {
  const reading = demoReadingInput("Reading", (key) => key, TODAY);
  const story = buildStory({ ...reading, people: reading.people.filter((person) => person.id === "duda" || person.id === "lucas") }) as DatedStory;
  assert.ok(story.together! > 10);
});
