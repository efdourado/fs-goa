import { ApiError } from "../../http";
import { dateString, midnightInTimeZone } from "./shared";

/**
 * When the thing itself happens — a match's kickoff, a screening. It lives on
 * the catalog item so every challenge using the item reads the same date; a
 * challenge's own "answers open/close" window is a different, restricting
 * setting on `challenge_items`.
 */
export interface EventSchedule {
  startsAt: Date;
  endsAt: Date | null;
  precision: "date" | "datetime";
  timeZone: string;
}

interface EventScheduleJson {
  startsAt: string;
  endsAt: string | null;
  precision: "date" | "datetime";
  timeZone: string;
}

interface EventScheduleRow {
  scheduled_at: Date | null;
  scheduled_end_at: Date | null;
  scheduled_precision: "date" | "datetime";
  scheduled_time_zone: string | null;
}

/** An IANA zone the platform's `Intl` actually knows — a typo would otherwise break every render of the date. */
export function ianaTimeZone(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || value.length > 100) {
    throw new ApiError(400, "invalid_timezone", "Fuso horário inválido.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    throw new ApiError(400, "invalid_timezone", "Fuso horário inválido.");
  }
  return value;
}

function instant(value: unknown, name: string): Date {
  if (typeof value !== "string") throw new ApiError(400, "invalid_schedule", `${name} inválida.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new ApiError(400, "invalid_schedule", `${name} inválida.`);
  return parsed;
}

const blank = (value: unknown) => value === undefined || value === null || value === "";

/**
 * Reads the API's `scheduledAt`: `null` clears it; `{ startsOn, endsOn?, timeZone? }` is
 * a calendar day (or range) with no clock time; `{ startsAt, endsAt?, timeZone? }` is a
 * precise instant with an optional end. Mixing the two shapes is rejected, not guessed.
 */
export function parseEventSchedule(value: unknown, fallbackTimeZone: string): EventSchedule | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "invalid_schedule", "Data e hora do evento inválidas.");
  }
  const body = value as Record<string, unknown>;
  const dateOnly = Object.hasOwn(body, "startsOn") || Object.hasOwn(body, "endsOn");
  const datetime = Object.hasOwn(body, "startsAt") || Object.hasOwn(body, "endsAt");
  if (dateOnly && datetime) {
    throw new ApiError(400, "invalid_schedule", "Use data e hora ou só a data para o evento, não uma mistura.");
  }
  if (!dateOnly && !datetime) return null;
  const timeZone = ianaTimeZone(body.timeZone, fallbackTimeZone);

  let startsAt: Date;
  let endsAt: Date | null;
  if (dateOnly) {
    if (blank(body.startsOn)) throw new ApiError(400, "invalid_schedule", "Informe a data do evento.");
    startsAt = midnightInTimeZone(dateString(body.startsOn, "Data do evento"), timeZone);
    endsAt = blank(body.endsOn) ? null : midnightInTimeZone(dateString(body.endsOn, "Data final do evento"), timeZone);
  } else {
    if (blank(body.startsAt)) throw new ApiError(400, "invalid_schedule", "Informe a data e a hora do evento.");
    startsAt = instant(body.startsAt, "Data e hora do evento");
    endsAt = blank(body.endsAt) ? null : instant(body.endsAt, "Fim do evento");
  }
  if (endsAt && endsAt.getTime() < startsAt.getTime()) {
    throw new ApiError(400, "invalid_schedule", "O fim do evento não pode ser anterior ao início.");
  }
  return { startsAt, endsAt, precision: dateOnly ? "date" : "datetime", timeZone };
}

/** Column values for an INSERT/UPDATE — all null when there's no schedule (the DB check requires that). */
export function eventScheduleColumns(schedule: EventSchedule | null) {
  return {
    scheduled_at: schedule?.startsAt ?? null,
    scheduled_end_at: schedule?.endsAt ?? null,
    scheduled_precision: schedule?.precision ?? "datetime",
    scheduled_time_zone: schedule?.timeZone ?? null,
  };
}

function eventScheduleFromRow(row: EventScheduleRow): EventSchedule | null {
  if (!row.scheduled_at) return null;
  return {
    startsAt: row.scheduled_at,
    endsAt: row.scheduled_end_at,
    precision: row.scheduled_precision,
    // A row saved by the schema check always carries a zone; the fallback only covers old, hand-edited data.
    timeZone: row.scheduled_time_zone ?? "UTC",
  };
}

export function eventScheduleJson(row: EventScheduleRow): EventScheduleJson | null {
  const schedule = eventScheduleFromRow(row);
  if (!schedule) return null;
  return {
    startsAt: schedule.startsAt.toISOString(),
    endsAt: schedule.endsAt?.toISOString() ?? null,
    precision: schedule.precision,
    timeZone: schedule.timeZone,
  };
}

/**
 * SQL that yields `true` when the `scheduled_at` property is switched on for the
 * library the item belongs to. Off by default, so only an explicit "not hidden"
 * override row turns it on. `itemAlias` is the catalog_items alias in the query.
 */
export function scheduleVisibleSql(itemAlias: string): string {
  return `EXISTS (
    SELECT 1 FROM catalog_libraries sl
      JOIN catalog_native_property_configs sc ON sc.library_id = sl.id AND sc.property_key = 'scheduled_at'
     WHERE sl.group_id = ${itemAlias}.group_id AND sl.kind = ${itemAlias}.kind AND sc.hidden = false)`;
}
