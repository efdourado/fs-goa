import type { ChallengeDetail, ChallengeField, ChallengeItem, Entry, EntryPurpose, EntryTypeView, Id } from "../types";
import { dateKeyInSaoPaulo, displayAnswer, entryRatingReader, formatRuntime, valuesAsRecord } from "../utils";

/**
 * The exported log of a challenge, shaped for the printable document: who took part, the items in
 * coloured chapters with every answer they got, a diary of what wasn't about an item, and the scoreboard.
 * Pure data — the document component does all the wording and formatting.
 */

/** The document's own inks, printed the same in light and dark mode. */
export const DOC_COLORS = ["coral", "blue", "violet", "rose", "green", "amber"] as const;
export type DocColor = (typeof DOC_COLORS)[number];
/** People get the same inks in a different order, so person one never shares the first chapter's colour. */
const PERSON_COLORS: DocColor[] = ["rose", "blue", "green", "violet", "amber", "coral"];

/** Shared answers belong to the whole group, not a person. */
export const SHARED_PERSON = "shared";

export interface DocPerson {
  key: string;
  name: string;
  color: DocColor;
  isMe: boolean;
  entryCount: number;
  recommendedCount: number;
  ratingAvg: number | null;
}

export interface DocValue {
  label: string;
  text: string;
  type: ChallengeField["type"];
  /** Number fields: the value itself and its unit, so the document can format and add them up. */
  number: number | null;
  unit: string | null;
  /** Worth its own paragraph (a comment), rather than a chip in a line. */
  long: boolean;
}

export interface DocEntry {
  id: Id;
  personKey: string;
  typeName: string;
  purpose: EntryPurpose;
  day: string | null;
  values: DocValue[];
  rating: number | null;
  /** On a workout: the item it's about (an exercise), for the records it holds. */
  itemTitle: string | null;
  children: DocEntry[];
}

/** A person's short, repeated check-ins on one item (pages read each day), folded into one row. */
export interface DocProgress {
  personKey: string;
  points: Array<{ day: string | null; text: string }>;
  /** The sum when every point is one number (pages read in total). */
  total: number | null;
  label: string | null;
  unit: string | null;
}

export interface DocItem {
  id: Id;
  number: number;
  title: string;
  subtitle: string | null;
  meta: string[];
  year: number | null;
  recommender: { name: string; personKey: string | null } | null;
  note: string | null;
  chapter: number;
  entries: DocEntry[];
  progress: DocProgress[];
  ratings: Array<{ personKey: string; value: number }>;
  ratingAvg: number | null;
  lastDay: string | null;
}

export interface DocChapter {
  index: number;
  color: DocColor;
  title: string | null;
  subtitle: string | null;
  items: DocItem[];
}

export interface DocMonth {
  month: string;
  /** Every day with an entry, and whose. */
  days: Array<{ day: string; personKeys: string[] }>;
  entries: DocEntry[];
}

export interface DocRecord {
  itemId: Id;
  title: string;
  chapter: number;
  sessions: number;
  bests: Array<{ label: string; value: number; unit: string | null }>;
  lastDay: string | null;
}

export type DocStat =
  | { kind: "items"; value: number }
  | { kind: "entries"; value: number }
  | { kind: "people"; value: number }
  | { kind: "years"; from: number; to: number }
  | { kind: "runtime"; hours: number }
  | { kind: "pages"; value: number }
  | { kind: "days"; value: number }
  | { kind: "streak"; value: number };

export interface ExportModel {
  people: DocPerson[];
  chapters: DocChapter[];
  diary: DocMonth[];
  records: DocRecord[];
  sessionMode: boolean;
  ratingMax: number;
  hasRatings: boolean;
  hasRecommenders: boolean;
  champion: DocItem | null;
  disappointment: DocItem | null;
  overallAvg: number | null;
  stats: DocStat[];
  firstDay: string | null;
  lastDay: string | null;
}

const PROGRESS_PURPOSES = new Set<EntryPurpose>(["progress", "checkin"]);
const CHAPTER_TARGET = 5;

function entryDay(entry: Entry): string | null {
  if (entry.occurredOn) return entry.occurredOn.slice(0, 10);
  if (entry.submittedAt) {
    const parsed = new Date(entry.submittedAt);
    if (!Number.isNaN(parsed.getTime())) return dateKeyInSaoPaulo(parsed);
  }
  return null;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** The longest run of consecutive days in a set of `YYYY-MM-DD` keys. */
export function longestStreak(days: Iterable<string>): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const day of sorted) {
    const time = Date.parse(`${day}T00:00:00Z`);
    run = previous !== null && time - previous === 86_400_000 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = time;
  }
  return best;
}

function latest(days: Array<string | null>): string | null {
  return days.filter((day): day is string => Boolean(day)).sort().at(-1) ?? null;
}

/** Up to five chapters of near-equal size, in order — the colour runs of a list with no sessions. */
function evenChapters(count: number): number[] {
  if (count < 6) return Array.from({ length: count }, () => 0);
  const size = Math.ceil(count / CHAPTER_TARGET);
  return Array.from({ length: count }, (_, index) => Math.floor(index / size));
}

export function buildExportModel(input: {
  challenge: ChallengeDetail;
  entries: Entry[];
  userId: Id;
  onlyMine?: boolean;
  words: { yes: string; no: string; group: string };
}): ExportModel {
  const { challenge, userId, words } = input;
  const typeById = new Map<Id, EntryTypeView>(challenge.entryTypes.map((type) => [type.id, type]));
  const readRating = entryRatingReader(challenge);
  const sessionMode = challenge.entryTypes.some((type) => type.parentTypeId);

  const personKeyOf = (entry: Entry) => (entry.answerScope === "shared" || !entry.userId ? SHARED_PERSON : entry.userId);
  const visible = input.onlyMine
    ? input.entries.filter((entry) => personKeyOf(entry) === SHARED_PERSON || entry.userId === userId)
    : input.entries;
  // A record inside a workout is shown with its workout — never on its own.
  const topLevel = visible.filter((entry) => !entry.parentEntryId);
  const childrenOf = new Map<Id, Entry[]>();
  for (const entry of visible) {
    if (!entry.parentEntryId) continue;
    childrenOf.set(entry.parentEntryId, [...(childrenOf.get(entry.parentEntryId) ?? []), entry]);
  }

  // People: the challenge's participants first, in their order, then anyone else an entry names.
  const people = new Map<string, DocPerson>();
  const addPerson = (key: string, name: string) => {
    if (people.has(key)) return;
    people.set(key, {
      key, name, color: PERSON_COLORS[people.size % PERSON_COLORS.length], isMe: key === userId,
      entryCount: 0, recommendedCount: 0, ratingAvg: null,
    });
  };
  for (const participant of challenge.participants) {
    const key = participant.userId ?? participant.id;
    if (!input.onlyMine || key === userId) addPerson(key, participant.name);
  }
  for (const entry of topLevel) {
    const key = personKeyOf(entry);
    addPerson(key, key === SHARED_PERSON ? words.group : entry.participantName ?? "—");
  }

  const itemById = new Map<Id, ChallengeItem>(challenge.items.map((item) => [item.id, item]));
  const toDocEntry = (entry: Entry): DocEntry => {
    const type = typeById.get(entry.entryTypeId ?? "");
    const record = valuesAsRecord(entry.values);
    const values: DocValue[] = [];
    for (const field of type?.fields ?? []) {
      const key = field.id ?? field.key;
      const text = displayAnswer(field, record[key], words).trim();
      if (!text) continue;
      const numeric = field.type === "number" && Number.isFinite(Number(record[key])) ? Number(record[key]) : null;
      values.push({
        label: field.label, text, type: field.type, number: numeric, unit: field.config?.unit ?? null,
        long: field.type === "text" && (Boolean(field.config?.multiline) || text.length > 48),
      });
    }
    const children = (childrenOf.get(entry.id) ?? [])
      .slice()
      .sort((a, b) => (itemById.get(a.itemId ?? "")?.position ?? 0) - (itemById.get(b.itemId ?? "")?.position ?? 0))
      .map(toDocEntry);
    return {
      id: entry.id,
      personKey: personKeyOf(entry),
      typeName: type?.name ?? "",
      purpose: type?.purpose ?? "checkin",
      day: entryDay(entry),
      values,
      rating: readRating(entry),
      itemTitle: entry.itemId ? itemById.get(entry.itemId)?.title ?? null : null,
      children,
    };
  };

  const sortedItems = challenge.items.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const byItem = new Map<Id, Entry[]>();
  const diaryEntries: Entry[] = [];
  for (const entry of topLevel) {
    if (!sessionMode && entry.itemId && itemById.has(entry.itemId)) {
      byItem.set(entry.itemId, [...(byItem.get(entry.itemId) ?? []), entry]);
    } else {
      diaryEntries.push(entry);
    }
  }

  // Chapters: the challenge's own sessions when its items are organised under them, else even colour runs.
  const checkpointOrder = new Map(challenge.checkpoints.map((checkpoint, index) => [checkpoint.id, index]));
  const grouped = sortedItems.some((item) => item.checkpointId && checkpointOrder.has(item.checkpointId));
  const chapterKeys: Array<Id | null> = [];
  const chapterOf = new Map<Id, number>();
  if (grouped) {
    const ordered = sortedItems.slice().sort((a, b) =>
      (checkpointOrder.get(a.checkpointId ?? "") ?? Number.MAX_SAFE_INTEGER) - (checkpointOrder.get(b.checkpointId ?? "") ?? Number.MAX_SAFE_INTEGER)
      || (a.position ?? 0) - (b.position ?? 0));
    sortedItems.splice(0, sortedItems.length, ...ordered);
    for (const item of sortedItems) {
      const key = item.checkpointId && checkpointOrder.has(item.checkpointId) ? item.checkpointId : null;
      if (!chapterKeys.includes(key)) chapterKeys.push(key);
      chapterOf.set(item.id, chapterKeys.indexOf(key));
    }
  } else {
    evenChapters(sortedItems.length).forEach((chapter, index) => chapterOf.set(sortedItems[index].id, chapter));
  }

  const items: DocItem[] = sortedItems.map((item, index) => {
    const own = (byItem.get(item.id) ?? []).map((entry) => ({ entry, doc: toDocEntry(entry) }));
    const rows: DocEntry[] = [];
    const progressByPerson = new Map<string, DocEntry[]>();
    for (const { doc } of own) {
      // A running tally (pages read today) folds into one line per person; a verdict keeps its own row.
      const short = doc.values.every((value) => !value.long);
      if (PROGRESS_PURPOSES.has(doc.purpose) && short && doc.values.length <= 1) {
        progressByPerson.set(doc.personKey, [...(progressByPerson.get(doc.personKey) ?? []), doc]);
      } else {
        rows.push(doc);
      }
    }
    const progress: DocProgress[] = [...progressByPerson].map(([personKey, docs]) => {
      const sorted = docs.slice().sort((a, b) => (a.day ?? "").localeCompare(b.day ?? ""));
      const numbers = sorted.map((doc) => doc.values[0]?.number ?? NaN);
      const allNumbers = numbers.length > 0 && numbers.every((value) => Number.isFinite(value));
      return {
        personKey,
        points: sorted.map((doc) => ({ day: doc.day, text: doc.values[0]?.text ?? "" })),
        total: allNumbers ? numbers.reduce((sum, value) => sum + value, 0) : null,
        label: sorted[0]?.values[0]?.label ?? null,
        unit: sorted[0]?.values[0]?.unit ?? null,
      };
    });
    rows.sort((a, b) => (a.day ?? "").localeCompare(b.day ?? "") || personIndex(a.personKey) - personIndex(b.personKey));

    // One rating per person — their latest, when they rated twice.
    const ratingByPerson = new Map<string, { value: number; day: string }>();
    for (const doc of own.map((row) => row.doc)) {
      if (doc.rating === null) continue;
      const previous = ratingByPerson.get(doc.personKey);
      if (!previous || (doc.day ?? "") >= previous.day) ratingByPerson.set(doc.personKey, { value: doc.rating, day: doc.day ?? "" });
    }
    const ratings = [...ratingByPerson].map(([personKey, { value }]) => ({ personKey, value }))
      .sort((a, b) => personIndex(a.personKey) - personIndex(b.personKey));

    const catalog = item.catalogItem;
    const recommender = item.recommendedBy
      ? { name: item.recommendedBy.name, personKey: item.recommendedBy.kind === "member" && people.has(item.recommendedBy.id) ? item.recommendedBy.id : null }
      : null;
    return {
      id: item.id,
      number: index + 1,
      title: item.title,
      subtitle: catalog?.author ?? null,
      meta: [
        catalog?.year ? String(catalog.year) : null,
        formatRuntime(catalog?.runtimeMinutes),
        catalog?.mainGenre ?? null,
      ].filter((part): part is string => Boolean(part)),
      year: catalog?.year ?? null,
      recommender,
      note: item.description?.trim() || item.originNote?.trim() || null,
      chapter: chapterOf.get(item.id) ?? 0,
      entries: rows,
      progress,
      ratings,
      ratingAvg: mean(ratings.map((rating) => rating.value)),
      lastDay: latest(own.map((row) => row.doc.day)),
    };
  });

  function personIndex(key: string): number {
    const index = [...people.keys()].indexOf(key);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  }

  const chapterCount = grouped ? chapterKeys.length : Math.max(0, ...items.map((item) => item.chapter + 1));
  const chapters: DocChapter[] = Array.from({ length: chapterCount }, (_, index) => {
    const checkpoint = grouped && chapterKeys[index] ? challenge.checkpoints.find((row) => row.id === chapterKeys[index]) : null;
    return {
      index,
      color: DOC_COLORS[index % (DOC_COLORS.length - 1)],
      title: checkpoint?.title ?? null,
      subtitle: checkpoint?.description?.trim() || null,
      items: items.filter((item) => item.chapter === index),
    };
  }).filter((chapter) => chapter.items.length);

  // The diary: whatever wasn't about an item, month by month, newest last.
  const diaryDocs = diaryEntries.map(toDocEntry).sort((a, b) => (a.day ?? "").localeCompare(b.day ?? ""));
  const months = new Map<string, DocMonth>();
  for (const doc of diaryDocs) {
    const month = doc.day ? doc.day.slice(0, 7) : "";
    const bucket = months.get(month) ?? { month, days: [], entries: [] };
    if (doc.day) {
      const day = bucket.days.find((row) => row.day === doc.day);
      if (day) { if (!day.personKeys.includes(doc.personKey)) day.personKeys.push(doc.personKey); }
      else bucket.days.push({ day: doc.day, personKeys: [doc.personKey] });
    }
    bucket.entries.push(doc);
    months.set(month, bucket);
  }
  const diary = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));

  // Workouts: each item's best of every number field, across every visible record.
  const records: DocRecord[] = [];
  if (sessionMode) {
    const perItem = new Map<Id, DocEntry[]>();
    for (const doc of diaryDocs) {
      for (const child of doc.children) {
        const entry = visible.find((row) => row.id === child.id);
        if (entry?.itemId) perItem.set(entry.itemId, [...(perItem.get(entry.itemId) ?? []), child]);
      }
    }
    for (const item of sortedItems) {
      const docs = perItem.get(item.id);
      if (!docs?.length) continue;
      const bests = new Map<string, number>();
      const units = new Map<string, string | null>();
      for (const doc of docs) {
        for (const value of doc.values) {
          if (value.number === null) continue;
          units.set(value.label, value.unit);
          bests.set(value.label, Math.max(bests.get(value.label) ?? -Infinity, value.number));
        }
      }
      records.push({
        itemId: item.id, title: item.title, chapter: chapterOf.get(item.id) ?? 0, sessions: docs.length,
        bests: [...bests].map(([label, value]) => ({ label, value, unit: units.get(label) ?? null })),
        lastDay: latest(docs.map((doc) => doc.day)),
      });
    }
  }

  // Tallies per person.
  const allDocs = [...items.flatMap((item) => [...item.entries, ...item.progress.flatMap((row) => row.points.map(() => ({ personKey: row.personKey })))]), ...diaryDocs];
  for (const doc of allDocs) {
    const person = people.get(doc.personKey);
    if (person) person.entryCount += 1;
  }
  for (const item of items) {
    const key = item.recommender?.personKey;
    if (key && people.has(key)) people.get(key)!.recommendedCount += 1;
  }
  for (const person of people.values()) {
    person.ratingAvg = mean(items.flatMap((item) => item.ratings.filter((rating) => rating.personKey === person.key).map((rating) => rating.value)));
  }
  // Nobody who never wrote a thing (and no empty "group") crowds the cover.
  const activePeople = [...people.values()].filter((person) => person.entryCount > 0 || person.recommendedCount > 0 || (person.key !== SHARED_PERSON && people.size <= 6));

  const rated = items.filter((item) => item.ratingAvg !== null);
  const byRating = rated.slice().sort((a, b) => (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0) || a.number - b.number);
  const champion = byRating[0] ?? null;
  const lowest = byRating.at(-1) ?? null;
  const disappointment = rated.length > 1 && lowest && lowest.ratingAvg !== champion?.ratingAvg ? lowest : null;

  const ratingFields = challenge.entryTypes.flatMap((type) => type.fields).filter((field) => field.type === "rating");
  const ratingMax = Math.max(5, ...ratingFields.map((field) => field.config?.max ?? 5));

  const everyDay = [...items.flatMap((item) => [...item.entries.map((doc) => doc.day), ...item.progress.flatMap((row) => row.points.map((point) => point.day))]), ...diaryDocs.map((doc) => doc.day)]
    .filter((day): day is string => Boolean(day)).sort();
  const years = items.map((item) => item.year).filter((year): year is number => typeof year === "number");
  const runtime = sortedItems.reduce((sum, item) => sum + (item.catalogItem?.runtimeMinutes ?? 0), 0);
  const pages = sortedItems.reduce((sum, item) => sum + (item.catalogItem?.pageCount ?? 0), 0);
  const stats: DocStat[] = [
    items.length ? { kind: "items" as const, value: items.length } : null,
    { kind: "entries" as const, value: topLevel.length },
    years.length > 1 && Math.min(...years) !== Math.max(...years) ? { kind: "years" as const, from: Math.min(...years), to: Math.max(...years) } : null,
    runtime >= 60 ? { kind: "runtime" as const, hours: Math.round(runtime / 60) } : null,
    pages > 0 ? { kind: "pages" as const, value: pages } : null,
    { kind: "days" as const, value: new Set(everyDay).size },
    diaryDocs.length && longestStreak(everyDay) > 1 ? { kind: "streak" as const, value: longestStreak(everyDay) } : null,
    activePeople.length > 1 ? { kind: "people" as const, value: activePeople.length } : null,
  ].filter((stat): stat is DocStat => stat !== null).slice(0, 4);

  return {
    people: activePeople,
    chapters,
    diary,
    records,
    sessionMode,
    ratingMax,
    hasRatings: rated.length > 0,
    hasRecommenders: items.some((item) => item.recommender),
    champion,
    disappointment,
    overallAvg: mean(items.flatMap((item) => item.ratings.map((rating) => rating.value))),
    stats,
    firstDay: everyDay[0] ?? null,
    lastDay: everyDay.at(-1) ?? null,
  };
}

/** Splits a title into up to three lines of near-even length — the cover's stacked, coloured headline. */
export function coverLines(title: string): string[] {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 3) return words;
  const target = title.length / 3;
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > target && lines.length < 2) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}
