import type { ChallengeDetail, ChallengeField, Entry, Id } from "../types";
import { entryRatingReader, itemIdForEntry, valuesAsRecord } from "../utils";

/**
 * "The thread": a challenge told as one drawing plus an almanac of everything its data can say.
 *
 * Two shapes of challenge, one input:
 *  · rated (films, books, places) — every person is a line through the titles, rising and falling with
 *    their rating; the almanac ranks, groups by genre / decade / length / any property, finds critics,
 *    pairs and common ground.
 *  · dated (habits, reading, workouts) — every person is a lane across the days, streaks drawn solid;
 *    the almanac counts streaks, consistency, weekdays, comebacks, totals and personal records.
 *
 * Everything here is pure and says only what the data backs: a fact without enough behind it is left out,
 * never invented, and missing answers stay missing (never zero).
 */

export interface StoryPerson { id: Id; name: string }
export interface StoryProperty { label: string; value: string }
export interface StoryItem {
  id: Id;
  title: string;
  year?: number | null;
  genre?: string | null;
  runtime?: number | null;
  /** Author/director and any custom text property the library defines. */
  properties?: StoryProperty[];
}
export interface StoryRating { personId: Id; itemId: Id; value: number; comment?: string | null }
export interface StoryExpectation { personId: Id; itemId: Id; value: number }
/** One dated check-in: a habit's day, a day's pages, a workout. `value` only when the day has a number. */
export interface StoryDay { personId: Id; day: string; value?: number | null; note?: string | null }
/** One record inside a workout: this item, this day, this number (the load). */
export interface StoryRecord { personId: Id; itemId: Id; day: string; value: number }

export interface StoryInput {
  title: string;
  noun: "film" | "book" | "place" | "item";
  people: StoryPerson[];
  items: StoryItem[];
  ratings: StoryRating[];
  expectations: StoryExpectation[];
  scale: { min: number; max: number };
  /**
   * Per item, the Goa score the ranking uses instead of the plain average (see `app/goa/score.ts`) and the
   * ratings it counts — used only when every one of them is a rating this story can see.
   */
  scores?: Record<Id, { value: number; count: number }>;
  days: StoryDay[];
  records: StoryRecord[];
  /** The counted number's label and unit on a dated challenge ("Páginas", "km"). */
  counter?: { label: string; unit?: string | null } | null;
  recordLabel?: string | null;
  /** The record's unit ("kg") — from the field, or read off a label like "Carga (kg)". */
  recordUnit?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  today: string;
}

export interface Landed { personId: Id; name: string; value: number }
export interface ItemScore { item: StoryItem; average: number; ratings: Landed[]; spread: number }
export interface GroupStat { key: string; count: number; average: number; items: string[] }

/** A note pinned onto the drawing at one title (and optionally one person's point on it). */
export type RatedNote =
  | { kind: "favourite"; itemId: Id; value: number }
  | { kind: "split"; itemId: Id; low: number; high: number }
  | { kind: "surprise"; itemId: Id; expected: number; actual: number }
  | { kind: "flop"; itemId: Id; value: number }
  | { kind: "loner"; itemId: Id; personId: Id; value: number }
  | { kind: "quote"; itemId: Id; personId: Id; text: string };

export interface RatedStory {
  kind: "rated";
  stations: ItemScore[];
  /** Per person, their rating at each station (null when they skipped it). */
  threads: Array<{ person: StoryPerson; values: Array<number | null> }>;
  notes: RatedNote[];
  totals: { people: number; items: number; ratings: number; comments: number; minutes: number | null };
  mood: "sync" | "mixed" | "apart";
  ranking: ItemScore[];
  genres: GroupStat[];
  /** Every release year with its titles, oldest first — shown once there are two different years. */
  years: GroupStat[];
  length: { longest: ItemScore; shortest: ItemScore; longAverage: number | null; shortAverage: number | null } | null;
  properties: Array<{ label: string; best: GroupStat; runnerUp: GroupStat | null }>;
  critics: Array<{ person: StoryPerson; average: number; count: number; top: number; favourite: ItemScore | null }>;
  pairs: Array<{ a: StoryPerson; b: StoryPerson; agreement: number; shared: number }>;
  commonGround: Array<{ a: StoryPerson; b: StoryPerson; agreement: number; genre: string; aAverage: number; bAverage: number }>;
  surprises: Array<{ item: StoryItem; expected: number; actual: number }>;
  quotes: Array<{ person: StoryPerson; item: StoryItem; value: number; text: string }>;
  /** Exactly two people: what each brought, instead of how "in sync" they are. */
  duo: Duo | null;
  /** One person: how they use the scale, their perfect scores, how good their instincts are. */
  solo: Solo | null;
}

/** A title seen by both, with each one's number. */
export interface DuoTitle { item: StoryItem; a: number; b: number }

/**
 * Two people read as a mix, not a score: where they met, what each brought (titles one lifted above the
 * other), the one they both loved most, the one they'll argue about, and how each leans by genre.
 */
export interface Duo {
  a: StoryPerson;
  b: StoryPerson;
  met: DuoTitle[];
  aBrought: DuoTitle[];
  bBrought: DuoTitle[];
  /** Titles both rated that fall in none of the three (a small difference, not a gift either way). */
  between: number;
  sharedFavourite: DuoTitle | null;
  argument: DuoTitle | null;
  aAverage: number;
  bAverage: number;
  leanings: Array<{ genre: string; a: number; b: number; count: number }>;
}

export interface Solo {
  person: StoryPerson;
  average: number;
  /** How many ratings fell on each step of the scale, low to high. */
  distribution: Array<{ value: number; count: number }>;
  perfect: ItemScore[];
  lowest: ItemScore | null;
  /** Guess against rating, when there were guesses: the typical miss, and how many landed within half a point. */
  instincts: { miss: number; close: number; total: number } | null;
}

export interface Lane {
  person: StoryPerson;
  /** Every logged day, ascending, with its number when it has one. */
  days: Array<{ day: string; value: number | null }>;
  total: number | null;
  longest: { from: string; to: string; length: number } | null;
  current: number;
  consistency: number | null;
  best: { day: string; value: number } | null;
  comeback: { gap: number; back: string } | null;
}

export interface DatedStory {
  kind: "dated";
  from: string;
  to: string;
  lanes: Lane[];
  totals: { people: number; days: number; checkins: number; total: number | null };
  weekdays: number[];
  /** The weekdays that stand out (tied at the top, clearly above the rest); empty when the week is even. */
  bestWeekdays: number[];
  /** Workouts: per exercise, where it started, the best it reached, and every session's number in order. */
  records: Array<{ item: StoryItem; first: number; best: number; bestDay: string; person: StoryPerson; sessions: number; series: number[] }>;
  notes: Array<{ person: StoryPerson; day: string; text: string }>;
  /** Two people: the days both of them showed up. */
  together: number | null;
}

export type Story = RatedStory | DatedStory | { kind: "empty" };

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const round1 = (value: number) => Math.round(value * 10) / 10;

export function addDaysKey(day: string, offset: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** Groups scored titles by a key, keeping only groups with enough titles to mean something. */
function groupBy(scores: ItemScore[], keyOf: (item: StoryItem) => string | null, minCount = 1): GroupStat[] {
  const map = new Map<string, ItemScore[]>();
  for (const score of scores) {
    const key = keyOf(score.item);
    if (!key) continue;
    map.set(key, [...(map.get(key) ?? []), score]);
  }
  return [...map.entries()]
    .filter(([, list]) => list.length >= minCount)
    .map(([key, list]) => ({ key, count: list.length, average: round1(mean(list.map((score) => score.average))), items: list.map((score) => score.item.title) }))
    // One title is an anecdote, not a pattern: groups of two or more rank first.
    .sort((a, b) => Number(b.count >= 2) - Number(a.count >= 2) || b.average - a.average || b.count - a.count);
}

function buildRated(input: StoryInput): RatedStory | null {
  const range = Math.max(1e-9, input.scale.max - input.scale.min);
  const nameOf = new Map(input.people.map((person) => [person.id, person.name]));
  const personOf = new Map(input.people.map((person) => [person.id, person]));
  const ratings = input.ratings.filter((rating) => nameOf.has(rating.personId));
  const stations: ItemScore[] = [];
  for (const item of input.items) {
    const landed = ratings.filter((rating) => rating.itemId === item.id).map((rating) => ({ personId: rating.personId, name: nameOf.get(rating.personId)!, value: rating.value }));
    if (!landed.length) continue;
    const values = landed.map((row) => row.value);
    const score = input.scores?.[item.id];
    const average = score && score.count === landed.length ? score.value : mean(values);
    stations.push({ item, average: round1(average), ratings: landed, spread: (Math.max(...values) - Math.min(...values)) / range });
  }
  if (!stations.length) return null;

  const group = input.people.length > 1;
  const shared = stations.filter((station) => station.ratings.length >= 2);
  const typicalSpread = shared.length ? mean(shared.map((station) => station.spread)) : 0;
  const ranking = [...stations].sort((a, b) => b.average - a.average || b.ratings.length - a.ratings.length);
  const valueOf = (personId: Id, itemId: Id) => ratings.find((rating) => rating.personId === personId && rating.itemId === itemId)?.value ?? null;

  // Pinned notes: each only when it tells something.
  const notes: RatedNote[] = [];
  if (stations.length >= 2) notes.push({ kind: "favourite", itemId: ranking[0].item.id, value: ranking[0].average });
  const split = group ? [...shared].sort((a, b) => b.spread - a.spread)[0] : undefined;
  if (split && split.spread >= 0.3) {
    const values = split.ratings.map((row) => row.value);
    notes.push({ kind: "split", itemId: split.item.id, low: Math.min(...values), high: Math.max(...values) });
    // The one furthest from everyone else on that title.
    if (split.ratings.length >= 3) {
      const gaps = split.ratings.map((row) => ({ row, gap: Math.abs(row.value - mean(split.ratings.filter((other) => other !== row).map((other) => other.value))) }));
      const loner = gaps.sort((a, b) => b.gap - a.gap)[0];
      if (loner.gap / range >= 0.35) notes.push({ kind: "loner", itemId: split.item.id, personId: loner.row.personId, value: loner.row.value });
    }
  }
  const surprises = stations.flatMap((station) => {
    const pairs = station.ratings.flatMap((row) => {
      const guess = input.expectations.find((expectation) => expectation.personId === row.personId && expectation.itemId === station.item.id);
      return guess ? [[guess.value, row.value] as const] : [];
    });
    return pairs.length ? [{ item: station.item, expected: round1(mean(pairs.map((pair) => pair[0]))), actual: round1(mean(pairs.map((pair) => pair[1]))) }] : [];
  }).sort((a, b) => Math.abs(b.actual - b.expected) - Math.abs(a.actual - a.expected));
  if (surprises[0] && Math.abs(surprises[0].actual - surprises[0].expected) / range >= 0.2) {
    notes.push({ kind: "surprise", itemId: surprises[0].item.id, expected: surprises[0].expected, actual: surprises[0].actual });
  }
  if (stations.length >= 4 && (ranking[0].average - ranking.at(-1)!.average) / range >= 0.25) {
    notes.push({ kind: "flop", itemId: ranking.at(-1)!.item.id, value: ranking.at(-1)!.average });
  }
  const quotes = ratings
    .filter((rating) => rating.comment && rating.comment.trim().length >= 12)
    .sort((a, b) => Number(b.itemId === split?.item.id) - Number(a.itemId === split?.item.id) || b.comment!.length - a.comment!.length)
    .slice(0, 4)
    .map((rating) => ({ person: personOf.get(rating.personId)!, item: input.items.find((item) => item.id === rating.itemId)!, value: rating.value, text: rating.comment!.trim() }));
  const pinnedQuote = quotes.find((quote) => quote.text.length <= 140);
  if (pinnedQuote) notes.push({ kind: "quote", itemId: pinnedQuote.item.id, personId: pinnedQuote.person.id, text: pinnedQuote.text });

  // Length: longest vs shortest, and whether long ones were worth it.
  const timed = stations.filter((station) => station.item.runtime);
  const length = timed.length >= 2
    ? (() => {
        const byLength = [...timed].sort((a, b) => b.item.runtime! - a.item.runtime!);
        const long = timed.filter((station) => station.item.runtime! > 120);
        const short = timed.filter((station) => station.item.runtime! <= 120);
        return {
          longest: byLength[0], shortest: byLength.at(-1)!,
          longAverage: long.length ? round1(mean(long.map((station) => station.average))) : null,
          shortAverage: short.length ? round1(mean(short.map((station) => station.average))) : null,
        };
      })()
    : null;

  // Any text property with a value that repeats (two titles by one director) earns a line.
  const labels = [...new Set(stations.flatMap((station) => (station.item.properties ?? []).map((property) => property.label)))];
  const properties = labels.flatMap((label) => {
    const stats = groupBy(stations, (item) => item.properties?.find((property) => property.label === label)?.value ?? null, 2);
    return stats.length ? [{ label, best: stats[0], runnerUp: stats[1] ?? null }] : [];
  });

  const critics = input.people.flatMap((person) => {
    const mine = ratings.filter((rating) => rating.personId === person.id);
    if (!mine.length) return [];
    const top = mine.filter((rating) => rating.value >= input.scale.max).length;
    const best = [...mine].sort((a, b) => b.value - a.value)[0];
    return [{ person, average: round1(mean(mine.map((rating) => rating.value))), count: mine.length, top, favourite: stations.find((station) => station.item.id === best.itemId) ?? null }];
  }).sort((a, b) => a.average - b.average);

  // Pairs: agreement over the titles both rated, and where two people who disagree still meet.
  const pairs: RatedStory["pairs"] = [];
  const commonGround: RatedStory["commonGround"] = [];
  for (const [index, a] of input.people.entries()) {
    for (const b of input.people.slice(index + 1)) {
      const both = stations.filter((station) => valueOf(a.id, station.item.id) !== null && valueOf(b.id, station.item.id) !== null);
      if (both.length < 3) continue;
      const agreement = Math.round(Math.max(0, 1 - mean(both.map((station) => Math.abs(valueOf(a.id, station.item.id)! - valueOf(b.id, station.item.id)!))) / range) * 100);
      pairs.push({ a, b, agreement, shared: both.length });
      const genres = new Map<string, Array<[number, number]>>();
      for (const station of both) {
        if (!station.item.genre) continue;
        genres.set(station.item.genre, [...(genres.get(station.item.genre) ?? []), [valueOf(a.id, station.item.id)!, valueOf(b.id, station.item.id)!]]);
      }
      const liked = [...genres.entries()]
        .map(([genre, rows]) => ({ genre, aAverage: round1(mean(rows.map((row) => row[0]))), bAverage: round1(mean(rows.map((row) => row[1]))) }))
        .filter((row) => (Math.min(row.aAverage, row.bAverage) - input.scale.min) / range >= 0.7)
        .sort((x, y) => Math.min(y.aAverage, y.bAverage) - Math.min(x.aAverage, x.bAverage))[0];
      if (liked) commonGround.push({ a, b, agreement, ...liked });
    }
  }
  pairs.sort((x, y) => y.agreement - x.agreement);
  // Common ground only means something between people who usually don't agree: below the group's median pair.
  const medianAgreement = pairs.length ? pairs[Math.floor(pairs.length / 2)].agreement : 0;
  const meeting = commonGround.filter((row) => row.agreement < Math.min(80, medianAgreement)).sort((x, y) => x.agreement - y.agreement);

  return {
    kind: "rated",
    stations,
    threads: input.people.map((person) => ({ person, values: stations.map((station) => valueOf(person.id, station.item.id)) })),
    notes,
    totals: {
      people: input.people.length,
      items: stations.length,
      ratings: ratings.length,
      comments: ratings.filter((rating) => rating.comment?.trim()).length,
      minutes: timed.length ? timed.reduce((sum, station) => sum + station.item.runtime! * station.ratings.length, 0) / Math.max(1, input.people.length) : null,
    },
    mood: typicalSpread < 0.15 ? "sync" : typicalSpread < 0.35 ? "mixed" : "apart",
    ranking,
    genres: (() => { const stats = groupBy(stations, (item) => item.genre ?? null); return stats.length >= 2 ? stats : []; })(),
    years: (() => { const stats = groupBy(stations, (item) => (item.year ? String(item.year) : null)).sort((a, b) => a.key.localeCompare(b.key)); return stats.length >= 2 ? stats : []; })(),
    length,
    properties,
    critics: group ? critics : [],
    pairs: group ? pairs : [],
    commonGround: group ? meeting.slice(0, 3) : [],
    surprises: surprises.slice(0, 4),
    quotes,
    duo: input.people.length === 2 ? buildDuo(input, stations, valueOf, range) : null,
    solo: input.people.length === 1 ? buildSolo(input, stations, ratings, range) : null,
  };
}

function buildDuo(input: StoryInput, stations: ItemScore[], valueOf: (personId: Id, itemId: Id) => number | null, range: number): Duo | null {
  const [a, b] = input.people;
  const both: DuoTitle[] = stations.flatMap((station) => {
    const va = valueOf(a.id, station.item.id);
    const vb = valueOf(b.id, station.item.id);
    return va !== null && vb !== null ? [{ item: station.item, a: va, b: vb }] : [];
  });
  if (!both.length) return null;
  // Within a tenth of the scale they met; beyond a fifth, one of them brought the title.
  const gap = (row: DuoTitle) => (row.a - row.b) / range;
  const byGap = (x: DuoTitle, y: DuoTitle) => Math.abs(gap(y)) - Math.abs(gap(x));
  const leanings = new Map<string, Array<[number, number]>>();
  for (const row of both) {
    if (!row.item.genre) continue;
    leanings.set(row.item.genre, [...(leanings.get(row.item.genre) ?? []), [row.a, row.b]]);
  }
  const argument = [...both].sort(byGap)[0];
  const met = both.filter((row) => Math.abs(gap(row)) <= 0.1);
  const aBrought = both.filter((row) => gap(row) >= 0.2).sort(byGap);
  const bBrought = both.filter((row) => gap(row) <= -0.2).sort(byGap);
  return {
    a, b, met, aBrought, bBrought,
    between: both.length - met.length - aBrought.length - bBrought.length,
    sharedFavourite: [...both].sort((x, y) => Math.min(y.a, y.b) - Math.min(x.a, x.b) || (y.a + y.b) - (x.a + x.b))[0] ?? null,
    argument: argument && Math.abs(gap(argument)) >= 0.3 ? argument : null,
    aAverage: round1(mean(both.map((row) => row.a))),
    bAverage: round1(mean(both.map((row) => row.b))),
    leanings: [...leanings.entries()]
      .map(([genre, rows]) => ({ genre, a: round1(mean(rows.map((row) => row[0]))), b: round1(mean(rows.map((row) => row[1]))), count: rows.length }))
      .sort((x, y) => y.count - x.count || (y.a + y.b) - (x.a + x.b)),
  };
}

function buildSolo(input: StoryInput, stations: ItemScore[], ratings: StoryRating[], range: number): Solo | null {
  const person = input.people[0];
  const mine = ratings.filter((rating) => rating.personId === person.id);
  if (!mine.length) return null;
  // Steps of half a point on a 0–5 scale, whole points on wider ones.
  const step = range <= 5 ? 0.5 : range <= 10 ? 1 : range / 10;
  const buckets = new Map<number, number>();
  for (let value = input.scale.min; value <= input.scale.max + 1e-9; value += step) buckets.set(round1(value), 0);
  for (const rating of mine) {
    const key = round1(Math.round((rating.value - input.scale.min) / step) * step + input.scale.min);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const top = Math.max(...mine.map((rating) => rating.value));
  const guesses = mine.flatMap((rating) => {
    const guess = input.expectations.find((row) => row.personId === person.id && row.itemId === rating.itemId);
    return guess ? [Math.abs(guess.value - rating.value)] : [];
  });
  const byValue = [...stations].sort((x, y) => x.average - y.average);
  return {
    person,
    average: round1(mean(mine.map((rating) => rating.value))),
    distribution: [...buckets.entries()].map(([value, count]) => ({ value, count })),
    perfect: stations.filter((station) => station.average >= top && top >= input.scale.max - step),
    lowest: byValue.length >= 3 ? byValue[0] : null,
    instincts: guesses.length ? { miss: round1(mean(guesses)), close: guesses.filter((miss) => miss <= 0.5).length, total: guesses.length } : null,
  };
}

function buildDated(input: StoryInput): DatedStory | null {
  const known = new Set(input.people.map((person) => person.id));
  const days = input.days.filter((row) => known.has(row.personId));
  if (!days.length) return null;
  const sortedDays = days.map((row) => row.day).sort();
  const from = [input.startsOn, sortedDays[0]].filter(Boolean).sort()[0]!;
  const lastLogged = sortedDays.at(-1)!;
  const end = input.endsOn && input.endsOn < input.today ? input.endsOn : input.today;
  const to = lastLogged > end ? lastLogged : end;
  const elapsed = daysBetween(from, to) + 1;
  const hasValues = days.some((row) => typeof row.value === "number");

  const lanes: Lane[] = input.people.map((person) => {
    const byDay = new Map<string, number | null>();
    for (const row of days.filter((candidate) => candidate.personId === person.id)) {
      const previous = byDay.get(row.day);
      const value = typeof row.value === "number" ? row.value : null;
      byDay.set(row.day, value === null ? previous ?? null : (previous ?? 0) + value);
    }
    const logged = [...byDay.entries()].map(([day, value]) => ({ day, value })).sort((a, b) => a.day.localeCompare(b.day));
    let longest: Lane["longest"] = null;
    let comeback: Lane["comeback"] = null;
    let runStart = logged[0]?.day ?? "";
    for (let index = 0; index < logged.length; index += 1) {
      const day = logged[index].day;
      const previous = logged[index - 1]?.day;
      if (previous && daysBetween(previous, day) > 1) {
        const gap = daysBetween(previous, day) - 1;
        if (gap >= 3 && (!comeback || gap > comeback.gap)) comeback = { gap, back: day };
        runStart = day;
      }
      const length = daysBetween(runStart, day) + 1;
      if (!longest || length > longest.length) longest = { from: runStart, to: day, length };
    }
    let current = 0;
    for (let cursor = input.today; byDay.has(cursor) || (current === 0 && byDay.has(addDaysKey(cursor, -1))); cursor = addDaysKey(cursor, -1)) {
      if (byDay.has(cursor)) current += 1;
      else if (current > 0) break;
    }
    const valued = logged.filter((row): row is { day: string; value: number } => row.value !== null);
    return {
      person,
      days: logged,
      total: hasValues ? valued.reduce((sum, row) => sum + row.value, 0) : null,
      longest: longest && longest.length >= 2 ? longest : null,
      current,
      consistency: logged.length ? Math.round((logged.length / elapsed) * 100) : null,
      best: valued.length ? valued.reduce((best, row) => (row.value > best.value ? row : best)) : null,
      comeback,
    };
  }).filter((lane) => lane.days.length);

  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  for (const lane of lanes) for (const row of lane.days) weekdays[new Date(`${row.day}T12:00:00Z`).getUTCDay()] += 1;
  const peak = Math.max(...weekdays);
  const bestWeekdays = peak > 0 && peak >= mean(weekdays) * 1.15 ? weekdays.flatMap((count, index) => (count === peak ? [index] : [])) : [];

  // Workouts: for each item, where the number started and the best it reached.
  const records: DatedStory["records"] = [];
  const recordKeys = new Map<string, StoryRecord[]>();
  for (const record of input.records.filter((row) => known.has(row.personId))) {
    const key = `${record.personId}:${record.itemId}`;
    recordKeys.set(key, [...(recordKeys.get(key) ?? []), record]);
  }
  for (const list of recordKeys.values()) {
    if (list.length < 2) continue;
    const ordered = [...list].sort((a, b) => a.day.localeCompare(b.day));
    const best = ordered.reduce((top, row) => (row.value > top.value ? row : top));
    const item = input.items.find((candidate) => candidate.id === ordered[0].itemId);
    if (!item || best.value <= ordered[0].value) continue;
    // One number per day (the heaviest set that day), oldest first — the line a card draws.
    const byDay = new Map<string, number>();
    for (const row of ordered) byDay.set(row.day, Math.max(byDay.get(row.day) ?? -Infinity, row.value));
    records.push({ item, first: ordered[0].value, best: best.value, bestDay: best.day, person: input.people.find((person) => person.id === ordered[0].personId)!, sessions: byDay.size, series: [...byDay.values()] });
  }
  records.sort((a, b) => (b.best - b.first) / Math.max(1e-9, b.first) - (a.best - a.first) / Math.max(1e-9, a.first));

  return {
    kind: "dated",
    from,
    to,
    lanes,
    totals: { people: lanes.length, days: elapsed, checkins: days.length, total: hasValues ? lanes.reduce((sum, lane) => sum + (lane.total ?? 0), 0) : null },
    weekdays,
    bestWeekdays,
    records: records.slice(0, 6),
    together: lanes.length === 2
      ? lanes[0].days.filter((row) => lanes[1].days.some((other) => other.day === row.day)).length
      : null,
    notes: days
      .filter((row) => row.note && row.note.trim().length >= 12)
      .sort((a, b) => b.note!.length - a.note!.length)
      .slice(0, 3)
      .map((row) => ({ person: input.people.find((person) => person.id === row.personId)!, day: row.day, text: row.note!.trim() })),
  };
}

export function buildStory(input: StoryInput): Story {
  return buildRated(input) ?? buildDated(input) ?? { kind: "empty" };
}

// ── From a real challenge ──────────────────────────────────────────────────

function textProperties(item: ChallengeDetail["items"][number]): StoryProperty[] {
  const catalog = item.catalogItem;
  if (!catalog) return [];
  const out: StoryProperty[] = [];
  if (catalog.author) out.push({ label: catalog.kind === "film" ? "director" : "author", value: catalog.author });
  for (const attribute of catalog.attributes ?? []) {
    if (attribute.type === "text" && typeof attribute.value === "string" && attribute.value.trim()) out.push({ label: attribute.label, value: attribute.value.trim() });
  }
  return out;
}

/** The single counted number of a dated form (pages, km), when it has exactly one. */
function counterOf(fields: ChallengeField[]): ChallengeField | null {
  const numbers = fields.filter((field) => field.id && field.type === "number");
  return numbers.length === 1 ? numbers[0] : null;
}

export function storyFromChallenge(challenge: ChallengeDetail, entries: Entry[], today: string): StoryInput {
  const readRating = entryRatingReader(challenge);
  const ratingTypes = new Set(challenge.entryTypes.filter((type) => type.purpose === "rating" && type.answerScope !== "shared").map((type) => type.id));
  const expectationType = challenge.entryTypes.find((type) => type.purpose === "expectation");
  const expectationField = expectationType?.fields.find((field) => field.type === "rating")?.id;
  const textFields = new Set(challenge.entryTypes.flatMap((type) => type.fields.filter((field) => field.type === "text").map((field) => field.id)));
  const ratingField = challenge.entryTypes.find((type) => ratingTypes.has(type.id))?.fields.find((field) => field.type === "rating");
  // Dated types: anything recorded per day that isn't a rating or an expectation.
  const recordType = challenge.entryTypes.find((type) => type.parentTypeId);
  const datedTypes = challenge.entryTypes.filter((type) =>
    !ratingTypes.has(type.id) && type.purpose !== "expectation" && type.id !== recordType?.id && type.answerScope !== "shared"
    && (type.cardinality === "once_per_day" || type.cardinality === "once_per_item_day" || type.purpose === "checkin" || type.purpose === "progress" || type.submissionMode === "daily"));
  const counters = new Map(datedTypes.map((type) => [type.id, counterOf(type.fields)]));
  const recordField = recordType ? counterOf(recordType.fields) ?? recordType.fields.find((field) => field.type === "number") ?? null : null;

  const ratings: StoryRating[] = [];
  const expectations: StoryExpectation[] = [];
  const days: StoryDay[] = [];
  const records: StoryRecord[] = [];
  const visitDay = new Map(entries.map((entry) => [entry.id, entry.occurredOn ?? entry.submittedAt?.slice(0, 10) ?? null]));
  for (const entry of entries) {
    if (!entry.userId) continue;
    const values = valuesAsRecord(entry.values);
    const note = [...textFields].map((id) => values[id ?? ""]).find((raw) => typeof raw === "string" && raw.trim()) as string | undefined;
    const itemId = itemIdForEntry(entry);
    if (ratingTypes.has(entry.entryTypeId ?? "") && itemId) {
      const value = readRating(entry);
      if (value !== null) ratings.push({ personId: entry.userId, itemId, value, comment: note ?? null });
    } else if (expectationType && entry.entryTypeId === expectationType.id && expectationField && itemId) {
      const value = Number(values[expectationField]);
      if (Number.isFinite(value)) expectations.push({ personId: entry.userId, itemId, value });
    } else if (recordType && entry.entryTypeId === recordType.id && itemId && recordField?.id) {
      const value = Number(values[recordField.id]);
      const day = entry.parentEntryId ? visitDay.get(entry.parentEntryId) : entry.occurredOn;
      if (Number.isFinite(value) && day) records.push({ personId: entry.userId, itemId, day, value });
    } else if (datedTypes.some((type) => type.id === entry.entryTypeId)) {
      const day = entry.occurredOn ?? entry.submittedAt?.slice(0, 10);
      if (!day) continue;
      const counter = counters.get(entry.entryTypeId ?? "");
      const raw = counter?.id ? Number(values[counter.id]) : NaN;
      days.push({ personId: entry.userId, day, value: Number.isFinite(raw) ? raw : null, note: note ?? null });
    }
  }
  const counterField = [...counters.values()].find(Boolean) ?? null;
  const kinds = new Set(challenge.items.map((item) => item.catalogItem?.kind));
  return {
    title: challenge.title,
    noun: kinds.size === 1 && kinds.has("film") ? "film" : kinds.size === 1 && kinds.has("book") ? "book" : challenge.recipeKey === "tables" ? "place" : "item",
    people: challenge.participants.filter((participant) => participant.userId).map((participant) => ({ id: participant.userId!, name: participant.name })),
    items: challenge.items.map((item) => ({
      id: item.id, title: item.title, year: item.catalogItem?.year ?? null, genre: item.catalogItem?.mainGenre ?? null,
      runtime: item.catalogItem?.runtimeMinutes ?? null, properties: textProperties(item),
    })),
    ratings,
    expectations,
    scale: { min: ratingField?.config?.min ?? 0, max: ratingField?.config?.max ?? 5 },
    scores: challenge.itemScores,
    days,
    records,
    counter: counterField ? { label: counterField.label, unit: counterField.config?.unit ?? null } : null,
    recordLabel: recordField?.label?.replace(/\s*\([^)]*\)\s*$/, "") ?? null,
    recordUnit: recordField?.config?.unit ?? recordField?.label?.match(/\(([^)]+)\)\s*$/)?.[1] ?? null,
    startsOn: challenge.startsOn ?? null,
    endsOn: challenge.endsOn ?? null,
    today,
  };
}
