import { useFormatter, useTranslations } from "next-intl";
import { useMemo } from "react";

import { ApiError } from "./api";
import type { ChallengeItem, ChallengeStatus, EventSchedule, SubmissionMode } from "./types";
import { instantToDateKey } from "./schedule";
import { isChallengeScheduled } from "./utils";

export type Translator = ((key: string, values?: Record<string, string | number | Date>) => string) & {
  has?: (key: string) => boolean;
};
export type Formatter = Pick<ReturnType<typeof useFormatter>, "dateTime">;

/** The two ends of an item's window, plus whether they were entered as whole days or as a date and time. */
export interface ItemWindow {
  opensAt?: string | null;
  dueAt?: string | null;
  schedulePrecision?: "date" | "datetime";
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Date-only keys are pinned to noon in São Paulo so the calendar day never shifts. */
function toDate(value: string): Date {
  return new Date(DAY_KEY.test(value) ? `${value}T12:00:00-03:00` : value);
}

/**
 * The locale-aware formatters and status labels the whole UI shares. Built once
 * from a translator + a formatter so it works both inside React (`useGoaFormat`)
 * and in plain code/tests (`makeGoaFormat` with `createTranslator`/`createFormatter`).
 */
export function makeGoaFormat(t: Translator, format: Formatter) {
  function date(value?: string | null, options?: Intl.DateTimeFormatOptions): string {
    if (!value) return t("dates.none");
    const parsed = toDate(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return format.dateTime(parsed, (options ?? { day: "2-digit", month: "short" }) as never);
  }

  function dateTime(value?: string | null): string {
    return date(value, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  /** One end of an item's window, in the challenge's own zone: a bare day for a date-only schedule, day and time for a precise one. */
  function windowEnd(value: string, precision: ItemWindow["schedulePrecision"], timeZone: string): string {
    if (precision === "datetime") {
      return format.dateTime(new Date(value), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone } as never);
    }
    return date(instantToDateKey(value, timeZone));
  }

  /** "Opens 12 Mar · due 19 Mar" — or `null` for an item with no schedule. */
  function itemWindow(item: ItemWindow, timeZone: string): string | null {
    if (!item.opensAt && !item.dueAt) return null;
    const opens = item.opensAt ? windowEnd(item.opensAt, item.schedulePrecision, timeZone) : null;
    const due = item.dueAt ? windowEnd(item.dueAt, item.schedulePrecision, timeZone) : null;
    if (opens && due) return t("itemWindow.both", { opens, due });
    if (opens) return t("itemWindow.opens", { opens });
    return t("itemWindow.due", { due: due ?? "" });
  }

  /** Just the due end, in the same style — "19 Mar" or "19 Mar, 20:00". */
  function itemDeadline(item: ItemWindow, timeZone: string): string | null {
    return item.dueAt ? windowEnd(item.dueAt, item.schedulePrecision, timeZone) : null;
  }

  /** "Mon, 15 Jun · 19:00–21:00 (GMT-3)" — when the thing itself happens, in the zone it was entered in. */
  function eventWhen(schedule: EventSchedule): string {
    const zone = schedule.timeZone;
    const dayOnly = (iso: string) => date(instantToDateKey(iso, zone), { weekday: "short", day: "2-digit", month: "short" });
    if (schedule.precision === "date") {
      const start = dayOnly(schedule.startsAt);
      const end = schedule.endsAt ? dayOnly(schedule.endsAt) : null;
      return end && end !== start ? t("eventWhen.range", { start, end }) : start;
    }
    const clock = (iso: string) => format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone } as never);
    const day = format.dateTime(new Date(schedule.startsAt), { weekday: "short", day: "2-digit", month: "short", timeZone: zone } as never);
    const zoneName = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "short" })
      .formatToParts(new Date(schedule.startsAt)).find((part) => part.type === "timeZoneName")?.value ?? zone;
    const sameDay = schedule.endsAt ? instantToDateKey(schedule.endsAt, zone) === instantToDateKey(schedule.startsAt, zone) : true;
    if (schedule.endsAt && sameDay) return t("eventWhen.timedRange", { day, start: clock(schedule.startsAt), end: clock(schedule.endsAt), zone: zoneName });
    return t("eventWhen.timed", { day, time: clock(schedule.startsAt), zone: zoneName });
  }

  function dateRange(startsOn?: string | null, endsOn?: string | null): string {
    if (startsOn && endsOn) return t("dates.range", { start: date(startsOn), end: date(endsOn) });
    if (startsOn) return t("dates.since", { date: date(startsOn) });
    if (endsOn) return t("dates.until", { date: date(endsOn) });
    return t("dates.noDeadline");
  }

  function itemStatusLabel(status?: ChallengeItem["status"]): string {
    return t(`itemStatus.${status ?? "planned"}`);
  }

  function challengeStatusLabel(status: ChallengeStatus, startsOn?: string | null, submissionMode?: SubmissionMode): string {
    return t(`challengeStatus.${isChallengeScheduled(status, startsOn, submissionMode) ? "scheduled" : status}`);
  }

  function entryUnavailableMessage(input: {
    challengeStatus: ChallengeStatus;
    isParticipant?: boolean;
    itemStatus?: ChallengeItem["status"];
    opensAt?: string | null;
    schedulePrecision?: ItemWindow["schedulePrecision"];
    timeZone?: string;
  }): string | null {
    if (input.challengeStatus === "closed") return t("entryForm.unavailable.closed");
    if (input.challengeStatus === "draft") return t("entryForm.unavailable.draft");
    if (input.isParticipant === false) return t("entryForm.unavailable.notParticipant");
    if (input.itemStatus === "scheduled") {
      return input.opensAt
        ? t("entryForm.unavailable.scheduledWithDate", {
            date: input.timeZone ? windowEnd(input.opensAt, input.schedulePrecision, input.timeZone) : dateTime(input.opensAt),
          })
        : t("entryForm.unavailable.scheduled");
    }
    if (input.itemStatus === "closed") return t("entryForm.unavailable.itemClosed");
    return null;
  }

  function has(key: string): boolean {
    return typeof t.has === "function" ? t.has(key) : false;
  }

  function error(cause: unknown): string {
    if (cause instanceof ApiError) {
      const code = (cause as { code?: string }).code;
      if (code && has(`errors.byCode.${code}`)) return t(`errors.byCode.${code}`);
      if (cause.message && cause.message !== code) return cause.message;
      if (has(`errors.byStatus.${cause.status}`)) return t(`errors.byStatus.${cause.status}`);
      return t("errors.operation");
    }
    if (cause instanceof Error) {
      // A native DOMException (e.g. an aborted fetch) carries a legacy
      // numeric `.code`, not a string — guard the type before calling
      // string methods on it.
      const code = (cause as { code?: unknown }).code;
      if (typeof code === "string" && code.startsWith("clipboard_") && has(`clipboard.${code.slice("clipboard_".length)}`)) {
        return t(`clipboard.${code.slice("clipboard_".length)}`);
      }
      if (cause instanceof TypeError && /fetch|network/i.test(cause.message)) return t("errors.network");
      return cause.message || t("errors.generic");
    }
    return t("errors.generic");
  }

  return { date, dateTime, dateRange, eventWhen, itemWindow, itemDeadline, itemStatusLabel, challengeStatusLabel, entryUnavailableMessage, error };
}

export type GoaFormat = ReturnType<typeof makeGoaFormat>;

export function useGoaFormat(): GoaFormat {
  const t = useTranslations();
  const format = useFormatter();
  return useMemo(() => makeGoaFormat(t as unknown as Translator, format as unknown as Formatter), [t, format]);
}
