import { ApiError } from "../../http";
import { validateDateValue } from "../../validation";

/**
 * The years a catalogue item may carry: negative for BC (the Odyssey is about −700), and up to the
 * far end of any release calendar. The database CHECK `catalog_items_year_check` states the same bounds.
 */
export const CATALOG_YEAR_MIN = -3000;
export const CATALOG_YEAR_MAX = 2200;

export function publicId(): string {
  return crypto.randomUUID();
}

export function semanticKey(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const key = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 64);
  return /^[a-z]/u.test(key) ? key : fallback;
}

export function dateString(value: unknown, name: string): string {
  const result = validateDateValue(value);
  if (!result.ok) throw new ApiError(400, "invalid_date", `${name}: ${result.message}`);
  return result.value;
}

interface ChallengeDateRange {
  startDate: string | null;
  endDate: string | null;
}

function missingDate(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Challenge schedules are deliberately all-or-nothing. A pair can point to the
 * past (historical backfill), the future, or be absent for a manually closed
 * challenge, but a half-filled range would make daily checkpoints ambiguous.
 */
export function dateRange(startValue: unknown, endValue: unknown): ChallengeDateRange {
  const startMissing = missingDate(startValue);
  const endMissing = missingDate(endValue);
  if (startMissing && endMissing) return { startDate: null, endDate: null };
  if (startMissing !== endMissing) {
    throw new ApiError(
      400,
      "date_pair_required",
      "Preencha início e término, ou deixe as duas datas vazias para um desafio sem prazo.",
    );
  }

  const startDate = dateString(startValue, "Data inicial");
  const endDate = dateString(endValue, "Data final");
  if (endDate < startDate) {
    throw new ApiError(400, "date_range", "A data final deve ser igual ou posterior ao início.");
  }
  return { startDate, endDate };
}

/** Canonical calendar key for business rules that must honor a named timezone. */
export function dateKeyInTimeZone(date: Date, timeZone: string): string {
  if (Number.isNaN(date.getTime())) throw new RangeError("Data inválida.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * The instant of local midnight on `dateKey` (YYYY-MM-DD) in `timeZone` — the
 * inverse of `dateKeyInTimeZone`. Used to store a date-only schedule (Phase 5)
 * as a real instant without guessing a UTC offset by hand: format a first
 * guess in the target zone, then correct by however far its wall clock reads
 * from `dateKey T00:00:00`. One correction is exact for every real-world
 * zone; a second guards the rare case where that correction crosses a DST
 * boundary.
 */
export function midnightInTimeZone(dateKey: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) throw new RangeError("Data inválida.");
  // The desired wall clock, expressed as if it were already UTC — fixed for
  // the whole search, so each step corrects toward it instead of re-deriving
  // a fresh (and, the second time, wrong) offset from whatever the previous
  // guess happened to be.
  const target = Date.UTC(year, month - 1, day, 0, 0, 0);
  let instant = target;
  for (let i = 0; i < 2; i += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(instant));
    const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const wallClockAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    const error = wallClockAsUtc - target;
    if (error === 0) break;
    instant -= error;
  }
  return new Date(instant);
}

/** A named IANA timezone is just a non-empty, reasonably short string here — the same shape `challenges_time_zone_check` allows. */
export function timeZoneValue(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || value.length < 1 || value.length > 100) {
    throw new ApiError(400, "invalid_timezone", "Fuso horário inválido.");
  }
  return value;
}

export function integerValue(value: unknown, fallback: number, min: number, max: number): number {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new ApiError(400, "invalid_number", `Use um número inteiro entre ${min} e ${max}.`);
  }
  return number;
}

/** Human-insensitive match key for a catalogue title: lowercase, no diacritics,
 *  collapsed whitespace. Lives here (a leaf) so both the catalogue and the bin's
 *  restore-with-rename build the exact same key. */
export function normalizeTitle(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 300);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
