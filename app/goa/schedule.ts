import type { EventBody, EventSchedule } from "./types";

export type { EventBody };

/**
 * Item schedules are stored as instants but *entered and read* in the
 * challenge's own time zone — a due date of "Friday" means Friday there, not in
 * whichever zone the browser happens to be in.
 */

function wallClockParts(ms: number, timeZone: string): { y: number; mo: number; d: number; h: number; mi: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute") };
}

/** How far ahead of UTC `timeZone`'s wall clock is at that instant. */
function zoneOffsetMs(ms: number, timeZone: string): number {
  const p = wallClockParts(ms, timeZone);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(ms / 60_000) * 60_000;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** `2026-09-18` → the day in `timeZone` that instant falls on. */
export function instantToDateKey(iso: string, timeZone: string): string {
  const p = wallClockParts(new Date(iso).getTime(), timeZone);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

/** An instant → the `YYYY-MM-DDTHH:mm` a `datetime-local` input shows for that zone. */
export function instantToWallClock(iso: string, timeZone: string): string {
  const p = wallClockParts(new Date(iso).getTime(), timeZone);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** What someone typed in a `datetime-local` input, read as that wall-clock time in `timeZone` → an ISO instant. `null` if blank or invalid. */
export function wallClockToInstant(local: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(asUtc)) return null;
  // Two passes settle the offset even right next to a daylight-saving change.
  const first = asUtc - zoneOffsetMs(asUtc, timeZone);
  const instant = asUtc - zoneOffsetMs(first, timeZone);
  return new Date(instant).toISOString();
}

// --- An item's own date and time (a match's kickoff): Date · Time · Time zone · optional end time ---------

/**
 * What the event inputs hold. The date comes first; the time is an on/off extra — `withTime` says
 * whether the clock times count. `endDate` and `endTime` are optional and read as "same day / no end" when empty.
 */
export interface EventForm {
  date: string;
  endDate: string;
  withTime: boolean;
  time: string;
  endTime: string;
  timeZone: string;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function isKnownTimeZone(zone: string): boolean {
  if (!zone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Every zone this browser knows, for the zone field's suggestions (empty where `Intl.supportedValuesOf` is missing). */
export function knownTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

export function emptyEventForm(timeZone: string): EventForm {
  return { date: "", endDate: "", withTime: false, time: "", endTime: "", timeZone };
}

export function eventFormOf(schedule: EventSchedule | null | undefined, fallbackTimeZone: string): EventForm {
  if (!schedule) return emptyEventForm(fallbackTimeZone);
  const zone = schedule.timeZone || fallbackTimeZone;
  const date = instantToDateKey(schedule.startsAt, zone);
  const endKey = schedule.endsAt ? instantToDateKey(schedule.endsAt, zone) : "";
  const endDate = endKey && endKey !== date ? endKey : "";
  if (schedule.precision === "date") return { date, endDate, withTime: false, time: "", endTime: "", timeZone: zone };
  return {
    date,
    endDate,
    withTime: true,
    time: instantToWallClock(schedule.startsAt, zone).slice(11),
    endTime: schedule.endsAt ? instantToWallClock(schedule.endsAt, zone).slice(11) : "",
    timeZone: zone,
  };
}

/** Where an event ends, as a local `date` (+ `time` when clock times count); `null` when no end was given. */
function endOf(form: EventForm): { date: string; time: string } | null {
  if (form.withTime) {
    // An end on the same day with no end time says nothing the start didn't.
    if (!form.endTime && (!form.endDate || form.endDate === form.date)) return null;
    return { date: form.endDate || form.date, time: form.endTime || form.time };
  }
  return form.endDate ? { date: form.endDate, time: "" } : null;
}

/** `null` when the form reads fine; otherwise which problem to show. */
export function eventFormProblem(form: EventForm): "zone" | "time" | "endOrder" | null {
  if (!form.date) return null;
  if (form.withTime && !isKnownTimeZone(form.timeZone)) return "zone";
  if (form.withTime && !form.time) return "time";
  const end = endOf(form);
  if (end && `${end.date}T${end.time}` <= `${form.date}T${form.withTime ? form.time : ""}`) {
    // A date range may end on its own start day (a one-day event); a timed one must end after it starts.
    return form.withTime || end.date < form.date ? "endOrder" : null;
  }
  return null;
}

export function eventBodyOf(form: EventForm): EventBody | null {
  // A zone still being typed ("Mars/Oly…") must never reach `Intl`, which throws on it.
  if (!form.date || (form.withTime && !isKnownTimeZone(form.timeZone))) return null;
  const timeZone = isKnownTimeZone(form.timeZone) ? form.timeZone : browserTimeZone();
  const end = endOf(form);
  if (!form.withTime) {
    return { startsOn: form.date, ...(end ? { endsOn: end.date } : {}), timeZone };
  }
  if (!form.time) return null;
  const startsAt = wallClockToInstant(`${form.date}T${form.time}`, timeZone);
  if (!startsAt) return null;
  return { startsAt, endsAt: end ? wallClockToInstant(`${end.date}T${end.time}`, timeZone) : null, timeZone };
}

/**
 * The form as one string, so it can sit among the other property values (which are all text).
 * Blank only while nothing was entered and the zone is still the default — a zone picked before
 * the date must survive the round trip, or the field would snap back as the person types.
 */
export function encodeEventForm(form: EventForm, defaultTimeZone: string): string {
  const untouched = !form.date && !form.endDate && !form.withTime && !form.time && !form.endTime && form.timeZone === defaultTimeZone;
  return untouched ? "" : JSON.stringify(form);
}

export function decodeEventForm(text: string | undefined, fallbackTimeZone: string): EventForm {
  if (!text) return emptyEventForm(fallbackTimeZone);
  try {
    const parsed = JSON.parse(text) as Partial<EventForm>;
    const time = typeof parsed.time === "string" ? parsed.time : "";
    return {
      date: typeof parsed.date === "string" ? parsed.date : "",
      endDate: typeof parsed.endDate === "string" ? parsed.endDate : "",
      withTime: typeof parsed.withTime === "boolean" ? parsed.withTime : Boolean(time),
      time,
      endTime: typeof parsed.endTime === "string" ? parsed.endTime : "",
      timeZone: typeof parsed.timeZone === "string" && parsed.timeZone ? parsed.timeZone : fallbackTimeZone,
    };
  } catch {
    return emptyEventForm(fallbackTimeZone);
  }
}

/** Where an event sits relative to `nowMs`: still ahead, under way (has an end and we're inside it, or it's today), or over. */
export function eventPhase(schedule: EventSchedule, nowMs: number): "upcoming" | "now" | "happened" {
  const zone = schedule.timeZone;
  if (schedule.precision === "date") {
    const today = instantToDateKey(new Date(nowMs).toISOString(), zone);
    const first = instantToDateKey(schedule.startsAt, zone);
    const last = schedule.endsAt ? instantToDateKey(schedule.endsAt, zone) : first;
    if (today < first) return "upcoming";
    return today > last ? "happened" : "now";
  }
  const start = new Date(schedule.startsAt).getTime();
  if (nowMs < start) return "upcoming";
  if (schedule.endsAt && nowMs <= new Date(schedule.endsAt).getTime()) return "now";
  return "happened";
}
