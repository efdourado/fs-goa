import type { ChallengeField } from "./types";

/**
 * Day arithmetic behind the Today tab's check-in log: which days it shows, the
 * streak, the running total before a day, and where an even pace would be.
 * Days are `YYYY-MM-DD` keys, compared as strings and stepped in UTC so a DST
 * change never skips or repeats one.
 */

export function addDays(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (0 on the same day, negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Every day from `from` to `to`, both included. */
export function dayList(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** How many days back an undated log reaches when nothing older was logged. */
export const UNDATED_WINDOW_DAYS = 35;

/**
 * The days the log shows. A dated challenge shows its whole period — or, for a
 * book with its own window, that window inside it. An undated one shows the last
 * five weeks, reaching further back to the first check-in. It always stretches
 * to take in every logged day, so nothing already saved is left off the strip.
 */
export function logRange(input: {
  today: string;
  startsOn?: string | null;
  endsOn?: string | null;
  opensOn?: string | null;
  dueOn?: string | null;
  loggedDays?: string[];
}): { from: string; to: string } {
  const { today, startsOn, endsOn, opensOn, dueOn } = input;
  const logged = [...(input.loggedDays ?? [])].sort();
  const later = (a: string, b: string) => (a > b ? a : b);
  const earlier = (a: string, b: string) => (a < b ? a : b);
  const starts = [startsOn, opensOn].filter((day): day is string => Boolean(day));
  const ends = [endsOn, dueOn].filter((day): day is string => Boolean(day));
  let from = starts.length ? starts.reduce(later) : addDays(today, -(UNDATED_WINDOW_DAYS - 1));
  let to = ends.length ? ends.reduce(earlier) : today;
  // A book past its due date is still being read: keep today reachable, but never past the challenge's own end.
  if (to < today) to = endsOn ? earlier(today, endsOn) : today;
  if (logged.length) {
    from = earlier(from, logged[0]);
    to = later(to, logged[logged.length - 1]);
  }
  if (to < from) to = from;
  return { from, to };
}

/** The Monday that opens a day's week — weeks run Monday to Sunday. */
function weekOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

/**
 * Consecutive weeks with at least one logged day, ending this week — or last week, while this one
 * is still empty. What "in a row" means for something done a few times a week, like a workout.
 */
export function weekStreak(logged: ReadonlySet<string>, today: string): number {
  const weeks = new Set([...logged].map(weekOf));
  let week = weekOf(today);
  if (!weeks.has(week)) week = addDays(week, -7);
  let count = 0;
  while (weeks.has(week)) {
    count += 1;
    week = addDays(week, -7);
  }
  return count;
}

/** Consecutive logged days ending today — or yesterday, while today is still open. */
export function streak(logged: ReadonlySet<string>, today: string): number {
  let count = 0;
  let day = logged.has(today) ? today : addDays(today, -1);
  while (logged.has(day)) {
    count += 1;
    day = addDays(day, -1);
  }
  return count;
}

/** The sum of every value logged strictly before `day` — where you were when that day began. */
export function sumBefore(values: ReadonlyMap<string, number>, day: string): number {
  let sum = 0;
  for (const [key, value] of values) if (key < day) sum += value;
  return sum;
}

export function sumAll(values: ReadonlyMap<string, number>): number {
  let sum = 0;
  for (const value of values.values()) sum += value;
  return sum;
}

/** "I stopped on page X" → that day's pages, given where the day began. */
export function amountFromPosition(position: number, before: number): number {
  return position - before;
}

/**
 * Where reading the same amount every day from `from` to `to` puts you by the
 * end of `today`, plus what's left per day to finish on time. `null` without a
 * total or a deadline — a pace is arithmetic, never a guess.
 */
export function pace(input: {
  total: number | null | undefined;
  from: string;
  to: string | null | undefined;
  today: string;
  done: number;
  loggedToday: boolean;
}): { expected: number; ahead: number; left: number; perDay: number | null } | null {
  const { total, from, to, today, done, loggedToday } = input;
  if (!total || total <= 0 || !to || to < from) return null;
  const span = daysBetween(from, to) + 1;
  const elapsed = Math.min(span, Math.max(0, daysBetween(from, today) + 1));
  const expected = Math.round((total * elapsed) / span);
  const left = Math.max(0, total - done);
  // Days still open for reading: from today (unless it's already logged) to the deadline.
  const daysLeft = today > to ? 0 : daysBetween(today, to) + 1 - (loggedToday ? 1 : 0);
  const perDay = left > 0 && daysLeft > 0 ? Math.ceil(left / daysLeft) : null;
  return { expected, ahead: done - expected, left, perDay };
}

/**
 * The single number field a log can count with — "Páginas lidas", km, minutes.
 * Only a type whose one number field can't go negative qualifies, and every
 * other field must be optional plain text (a note) the log's editor can carry.
 */
export function counterField(fields: ChallengeField[]): ChallengeField | null {
  const named = fields.filter((field) => field.id);
  const numbers = named.filter((field) => field.type === "number");
  if (numbers.length !== 1) return null;
  const [number] = numbers;
  if (number.config?.min !== undefined && number.config.min < 0) return null;
  const othersFit = named.every((field) => field === number || (field.type === "text" && !field.required));
  return othersFit ? number : null;
}

export type AmountProblem =
  | { code: "empty" }
  | { code: "notWhole" }
  | { code: "notPositive" }
  | { code: "belowStart"; before: number }
  | { code: "aboveMax"; max: number }
  | { code: "offStep"; step: number };

/**
 * Checks a day's amount before it's saved. `mode: "position"` means the person
 * typed where they stopped, so a value at or below where the day began is the
 * mistake to name. Going past a book's page count is only a warning (editions
 * differ) — see `overTotal`.
 */
export function checkAmount(input: {
  amount: number | null;
  mode: "amount" | "position";
  before: number;
  field: ChallengeField;
}): AmountProblem | null {
  const { amount, mode, before, field } = input;
  if (amount === null || !Number.isFinite(amount)) return { code: "empty" };
  const step = field.config?.step;
  const whole = step !== undefined && step > 0 && Number.isInteger(step);
  if (whole && !Number.isInteger(amount)) return { code: "notWhole" };
  if (amount <= 0) return mode === "position" ? { code: "belowStart", before } : { code: "notPositive" };
  if (field.config?.max !== undefined && amount > field.config.max) return { code: "aboveMax", max: field.config.max };
  if (step !== undefined && step > 0 && !whole) {
    const ratio = amount / step;
    if (Math.abs(ratio - Math.round(ratio)) > 1e-9) return { code: "offStep", step };
  }
  return null;
}

/** Whether saving `amount` on a day that held `current` takes the running total past `total`. */
export function overTotal(values: ReadonlyMap<string, number>, day: string, amount: number, total: number | null | undefined): boolean {
  if (!total) return false;
  return sumAll(values) - (values.get(day) ?? 0) + amount > total;
}

/** A month grid: blanks before the 1st (weeks start on Sunday), then every day of the month. */
export function monthCells(month: string): Array<string | null> {
  const first = `${month}-01`;
  const lead = new Date(`${first}T00:00:00Z`).getUTCDay();
  const cells: Array<string | null> = Array.from({ length: lead }, () => null);
  for (let day = first; day.slice(0, 7) === month; day = addDays(day, 1)) cells.push(day);
  return cells;
}

/** The `YYYY-MM` months a range touches, in order. */
export function monthsIn(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = from.slice(0, 7); month <= to.slice(0, 7);) {
    months.push(month);
    const [year, m] = month.split("-").map(Number);
    month = m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`;
  }
  return months;
}
