import { ApiError } from "../../http";
import { validateDateValue } from "../../validation";

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

export interface ChallengeDateRange {
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
