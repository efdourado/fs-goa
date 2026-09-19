import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  eventScheduleColumns,
  eventScheduleJson,
  ianaTimeZone,
  parseEventSchedule,
} from "../lib/goa/domain/event-schedule";

const zone = "America/Sao_Paulo";

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("event schedule", () => {
  test("a date with a time keeps the instant, the optional end and the zone", () => {
    const schedule = parseEventSchedule({ startsAt: "2026-06-15T19:00:00Z", endsAt: "2026-06-15T21:00:00Z", timeZone: "Europe/Lisbon" }, zone)!;
    assert.equal(schedule.precision, "datetime");
    assert.equal(schedule.startsAt.toISOString(), "2026-06-15T19:00:00.000Z");
    assert.equal(schedule.endsAt?.toISOString(), "2026-06-15T21:00:00.000Z");
    assert.equal(schedule.timeZone, "Europe/Lisbon");
  });

  test("a day alone becomes local midnight in its zone, and the end stays optional", () => {
    const schedule = parseEventSchedule({ startsOn: "2026-06-20" }, zone)!;
    assert.equal(schedule.precision, "date");
    assert.equal(schedule.startsAt.toISOString(), "2026-06-20T03:00:00.000Z");
    assert.equal(schedule.endsAt, null);
    assert.equal(schedule.timeZone, zone, "the fallback zone applies when none is sent");
  });

  test("null clears the schedule, and the columns are all empty together", () => {
    assert.equal(parseEventSchedule(null, zone), null);
    assert.deepEqual(eventScheduleColumns(null), {
      scheduled_at: null, scheduled_end_at: null, scheduled_precision: "datetime", scheduled_time_zone: null,
    });
  });

  test("the JSON shape round-trips through the columns", () => {
    const schedule = parseEventSchedule({ startsAt: "2026-06-15T19:00:00Z", timeZone: "UTC" }, zone)!;
    const columns = eventScheduleColumns(schedule);
    assert.deepEqual(eventScheduleJson(columns), {
      startsAt: "2026-06-15T19:00:00.000Z", endsAt: null, precision: "datetime", timeZone: "UTC",
    });
    assert.equal(eventScheduleJson({ ...columns, scheduled_at: null }), null);
  });

  test("bad input is rejected with a specific code instead of guessed", () => {
    assert.equal(code(() => parseEventSchedule({ startsAt: "2026-06-15T19:00:00Z", timeZone: "Mars/Olympus" }, zone)), "invalid_timezone");
    assert.equal(code(() => parseEventSchedule({ startsAt: "soon" }, zone)), "invalid_schedule");
    assert.equal(code(() => parseEventSchedule({ startsAt: "2026-06-15T19:00:00Z", endsAt: "2026-06-15T18:00:00Z" }, zone)), "invalid_schedule");
    assert.equal(code(() => parseEventSchedule({ startsOn: "2026-06-15", startsAt: "2026-06-15T19:00:00Z" }, zone)), "invalid_schedule");
    assert.equal(code(() => parseEventSchedule({ endsOn: "2026-06-15" }, zone)), "invalid_schedule");
    assert.equal(code(() => parseEventSchedule("2026-06-15", zone)), "invalid_schedule");
    assert.equal(code(() => parseEventSchedule(["x"], zone)), "invalid_schedule");
  });

  test("only names the platform knows count as time zones", () => {
    assert.equal(ianaTimeZone("Asia/Tokyo", zone), "Asia/Tokyo");
    assert.equal(ianaTimeZone(undefined, zone), zone);
    assert.equal(code(() => ianaTimeZone("Nowhere/Land", zone)), "invalid_timezone");
    assert.equal(code(() => ianaTimeZone(42, zone)), "invalid_timezone");
  });
});
