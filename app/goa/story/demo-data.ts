import { addDaysKey, type StoryDay, type StoryInput } from "./model";

/**
 * The public demo's two invented groups, written to tell a story — nothing here is real data.
 *  · A movie club: one clear favourite, one film that split the room, a surprise, taste twins, a flop,
 *    a director they keep coming back to, and two people who disagree on everything but comedy.
 *  · A reading habit: four friends, a month of daily pages — one long streak, one weekend reader,
 *    one comeback.
 * Comments and notes are i18n keys (`demo.comments.*`, `demo.notes.*`) so the demo reads in the visitor's language.
 */
const PEOPLE = [
  { id: "ana", name: "Ana" },
  { id: "bruno", name: "Bruno" },
  { id: "caio", name: "Caio" },
  { id: "duda", name: "Duda" },
  { id: "lucas", name: "Lucas" },
];

const FILMS = [
  { id: "past-lives", title: "Past Lives", year: 2023, genre: "Drama", runtime: 106, director: "Celine Song" },
  { id: "tar", title: "Tár", year: 2022, genre: "Drama", runtime: 158, director: "Todd Field" },
  { id: "barbie", title: "Barbie", year: 2023, genre: "Comedy", runtime: 114, director: "Greta Gerwig" },
  { id: "aftersun", title: "Aftersun", year: 2022, genre: "Drama", runtime: 102, director: "Charlotte Wells" },
  { id: "dune-2", title: "Dune: Part Two", year: 2024, genre: "Sci-fi", runtime: 166, director: "Denis Villeneuve" },
  { id: "anatomy", title: "Anatomy of a Fall", year: 2023, genre: "Thriller", runtime: 151, director: "Justine Triet" },
  { id: "arrival", title: "Arrival", year: 2016, genre: "Sci-fi", runtime: 116, director: "Denis Villeneuve" },
  { id: "megalopolis", title: "Megalopolis", year: 2024, genre: "Sci-fi", runtime: 138, director: "Francis Ford Coppola" },
];

//                      ana  bruno caio duda lucas
const RATINGS: Record<string, number[]> = {
  "past-lives": [5, 4.5, 3, 5, 5],
  tar: [5, 4.5, 1, 1.5, 5],
  barbie: [4.5, 4, 4.5, 4, 4],
  aftersun: [4.5, 3, 2, 3.5, 4.5],
  "dune-2": [3.5, 5, 5, 4, 3.5],
  anatomy: [4.5, 4, 2.5, 4.5, 4.5],
  arrival: [4, 4.5, 5, 3, 4],
  megalopolis: [1.5, 2, 3, 2.5, 1.5],
};

// What they expected before pressing play — Barbie is the one nobody saw coming.
const EXPECTATIONS: Record<string, number[]> = {
  barbie: [2, 1.5, 2.5, 2, 2],
  "dune-2": [4.5, 5, 4, 4, 4],
  megalopolis: [3.5, 4, 3, 3.5, 3.5],
};

const COMMENTS: Array<{ personId: string; itemId: string; key: string }> = [
  { personId: "caio", itemId: "tar", key: "tarCaio" },
  { personId: "ana", itemId: "tar", key: "tarAna" },
  { personId: "duda", itemId: "past-lives", key: "pastLivesDuda" },
  { personId: "bruno", itemId: "megalopolis", key: "megalopolisBruno" },
  { personId: "lucas", itemId: "barbie", key: "barbieLucas" },
];

export function demoFilmInput(title: string, comment: (key: string) => string, today: string): StoryInput {
  return {
    title,
    noun: "film",
    people: PEOPLE,
    items: FILMS.map((film) => ({ id: film.id, title: film.title, year: film.year, genre: film.genre, runtime: film.runtime, properties: [{ label: "director", value: film.director }] })),
    ratings: FILMS.flatMap((film) => PEOPLE.map((person, index) => ({
      personId: person.id,
      itemId: film.id,
      value: RATINGS[film.id][index],
      comment: (() => {
        const row = COMMENTS.find((candidate) => candidate.personId === person.id && candidate.itemId === film.id);
        return row ? comment(row.key) : null;
      })(),
    }))),
    expectations: Object.entries(EXPECTATIONS).flatMap(([itemId, values]) => PEOPLE.map((person, index) => ({ personId: person.id, itemId, value: values[index] }))),
    scale: { min: 0, max: 5 },
    days: [],
    records: [],
    today,
  };
}

/** The one film the demo's reveal plays out — the one that split the room. */
export const DEMO_REVEAL_ITEM = "tar";

/**
 * A month of pages, ending today. Each reader has a pattern: Duda almost never misses (a three-week run),
 * Bruno reads on weekends, Ana stops for a week and comes back strong, Lucas reads a little every day.
 */
export function demoReadingInput(title: string, note: (key: string) => string, today: string, counterLabel = "pages"): StoryInput {
  const from = addDaysKey(today, -29);
  const days: StoryDay[] = [];
  const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
  for (let offset = 0; offset < 30; offset += 1) {
    const day = addDaysKey(from, offset);
    const wave = (seed: number) => Math.round(18 + 14 * Math.abs(Math.sin(offset * 1.7 + seed)));
    if (offset !== 3 && offset !== 25) days.push({ personId: "duda", day, value: wave(1) + (offset === 17 ? 40 : 0), note: offset === 17 ? note("dudaBest") : null });
    if (weekday(day) === 0 || weekday(day) === 6) days.push({ personId: "bruno", day, value: wave(2) + 25, note: null });
    if (offset < 9 || offset > 16) days.push({ personId: "ana", day, value: wave(3), note: offset === 17 ? note("anaBack") : null });
    if (offset % 4 !== 1) days.push({ personId: "lucas", day, value: 10 + (offset % 3) * 2, note: offset === 29 ? note("lucasSmall") : null });
  }
  return {
    title,
    noun: "book",
    people: PEOPLE.filter((person) => person.id !== "caio"),
    items: [],
    ratings: [],
    expectations: [],
    scale: { min: 0, max: 5 },
    days,
    records: [],
    counter: { label: counterLabel, unit: null },
    startsOn: from,
    endsOn: today,
    today,
  };
}
