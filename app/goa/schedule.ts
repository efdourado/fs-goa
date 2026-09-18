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
