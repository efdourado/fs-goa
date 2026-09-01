import { useFormatter, useTranslations } from "next-intl";
import { useMemo } from "react";

import { ApiError } from "./api";
import type { ChallengeItem, ChallengeStatus, SubmissionMode } from "./types";
import { isChallengeScheduled } from "./utils";

export type Translator = ((key: string, values?: Record<string, string | number | Date>) => string) & {
  has?: (key: string) => boolean;
};
export type Formatter = Pick<ReturnType<typeof useFormatter>, "dateTime">;

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
  }): string | null {
    if (input.challengeStatus === "closed") return t("entryForm.unavailable.closed");
    if (input.challengeStatus === "draft") return t("entryForm.unavailable.draft");
    if (input.isParticipant === false) return t("entryForm.unavailable.notParticipant");
    if (input.itemStatus === "scheduled") {
      return input.opensAt
        ? t("entryForm.unavailable.scheduledWithDate", { date: dateTime(input.opensAt) })
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
      const code = (cause as { code?: string }).code;
      if (code?.startsWith("clipboard_") && has(`clipboard.${code.slice("clipboard_".length)}`)) {
        return t(`clipboard.${code.slice("clipboard_".length)}`);
      }
      if (cause instanceof TypeError && /fetch|network/i.test(cause.message)) return t("errors.network");
      return cause.message || t("errors.generic");
    }
    return t("errors.generic");
  }

  return { date, dateTime, dateRange, itemStatusLabel, challengeStatusLabel, entryUnavailableMessage, error };
}

export type GoaFormat = ReturnType<typeof makeGoaFormat>;

export function useGoaFormat(): GoaFormat {
  const t = useTranslations();
  const format = useFormatter();
  return useMemo(() => makeGoaFormat(t as unknown as Translator, format as unknown as Formatter), [t, format]);
}
