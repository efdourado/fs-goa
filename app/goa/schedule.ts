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

export type ScheduleMode = "none" | "date" | "datetime";

/** The mode an existing item's schedule is in: none if it has no window, else how it was entered. */
export function scheduleModeOf(item: { opensAt?: string | null; dueAt?: string | null; schedulePrecision?: "date" | "datetime" }): ScheduleMode {
  if (!item.opensAt && !item.dueAt) return "none";
  return item.schedulePrecision === "datetime" ? "datetime" : "date";
}

// --- An item's own date and time (a match's kickoff): Date · Time · Time zone · optional end time ---------

/** What the event inputs hold. A blank `time` means "the day is known, the hour isn't". */
export interface EventForm {
  date: string;
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
  return { date: "", time: "", endTime: "", timeZone };
}

export function eventFormOf(schedule: EventSchedule | null | undefined, fallbackTimeZone: string): EventForm {
  if (!schedule) return emptyEventForm(fallbackTimeZone);
  const zone = schedule.timeZone || fallbackTimeZone;
  const date = instantToDateKey(schedule.startsAt, zone);
  if (schedule.precision === "date") return { date, time: "", endTime: "", timeZone: zone };
  return {
    date,
    time: instantToWallClock(schedule.startsAt, zone).slice(11),
    endTime: schedule.endsAt ? instantToWallClock(schedule.endsAt, zone).slice(11) : "",
    timeZone: zone,
  };
}

/** `null` when the form reads fine; otherwise which problem to show. */
export function eventFormProblem(form: EventForm): "zone" | "endOrder" | "endWithoutTime" | null {
  if (!form.date) return null;
  if (!isKnownTimeZone(form.timeZone)) return "zone";
  if (form.endTime && !form.time) return "endWithoutTime";
  if (form.endTime && form.endTime <= form.time) return "endOrder";
  return null;
}

export function eventBodyOf(form: EventForm): EventBody | null {
  if (!form.date) return null;
  if (!form.time) return { startsOn: form.date, timeZone: form.timeZone };
  const startsAt = wallClockToInstant(`${form.date}T${form.time}`, form.timeZone);
  if (!startsAt) return null;
  const endsAt = form.endTime ? wallClockToInstant(`${form.date}T${form.endTime}`, form.timeZone) : null;
  return { startsAt, endsAt, timeZone: form.timeZone };
}

/**
 * The form as one string, so it can sit among the other property values (which are all text).
 * Blank only while nothing was entered and the zone is still the default — a zone picked before
 * the date must survive the round trip, or the field would snap back as the person types.
 */
export function encodeEventForm(form: EventForm, defaultTimeZone: string): string {
  const untouched = !form.date && !form.time && !form.endTime && form.timeZone === defaultTimeZone;
  return untouched ? "" : JSON.stringify(form);
}

export function decodeEventForm(text: string | undefined, fallbackTimeZone: string): EventForm {
  if (!text) return emptyEventForm(fallbackTimeZone);
  try {
    const parsed = JSON.parse(text) as Partial<EventForm>;
    return {
      date: typeof parsed.date === "string" ? parsed.date : "",
      time: typeof parsed.time === "string" ? parsed.time : "",
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
