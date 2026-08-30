import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ApiError } from "../lib/http";
import { dateKeyInTimeZone, dateRange } from "../lib/goa/domain/shared";

function assertRejected(work: () => unknown): void {
  assert.throws(work, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 400);
    return true;
  });
}

describe("challenge date range", () => {
  test("normalizes every pair of absent values to an undated range", () => {
    const absentValues = [undefined, null, ""] as const;

    for (const start of absentValues) {
      for (const end of absentValues) {
        assert.deepEqual(dateRange(start, end), {
          startDate: null,
          endDate: null,
        });
      }
    }
  });

  test("accepts canonical past, future, and single-day ranges", () => {
    assert.deepEqual(dateRange("1999-12-31", "2000-01-01"), {
      startDate: "1999-12-31",
      endDate: "2000-01-01",
    });
    assert.deepEqual(dateRange("2099-02-28", "2099-03-01"), {
      startDate: "2099-02-28",
      endDate: "2099-03-01",
    });
    assert.deepEqual(dateRange("2024-02-29", "2024-02-29"), {
      startDate: "2024-02-29",
      endDate: "2024-02-29",
    });
  });

  test("rejects a range with only one date", () => {
    const absentValues = [undefined, null, ""] as const;

    for (const absent of absentValues) {
      assertRejected(() => dateRange("2026-08-30", absent));
      assertRejected(() => dateRange(absent, "2026-08-30"));
    }
  });

  test("rejects invalid calendar dates and non-string values", () => {
    assertRejected(() => dateRange("2025-02-29", "2025-03-01"));
    assertRejected(() => dateRange("2026-08-01", "2026-02-30"));
    assertRejected(() => dateRange(new Date("2026-08-01T00:00:00Z"), "2026-08-02"));
  });

  test("rejects an end date before the start date", () => {
    assertRejected(() => dateRange("2026-08-31", "2026-08-30"));
  });
});

describe("date key in an IANA time zone", () => {
  test("changes day at midnight in America/Sao_Paulo, not at midnight UTC", () => {
    assert.equal(
      dateKeyInTimeZone(new Date("2026-08-30T02:59:59.999Z"), "America/Sao_Paulo"),
      "2026-08-29",
    );
    assert.equal(
      dateKeyInTimeZone(new Date("2026-08-30T03:00:00.000Z"), "America/Sao_Paulo"),
      "2026-08-30",
    );
  });
});
