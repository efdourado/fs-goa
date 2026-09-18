"use client";

import { useTranslations } from "next-intl";

import { instantToDateKey, instantToWallClock, type ScheduleMode, scheduleModeOf, wallClockToInstant } from "./schedule";
import type { ChallengeItem } from "./types";
import { Field, inputClass, SelectableCards } from "./ui";

/** What the schedule inputs hold: a day (`YYYY-MM-DD`) or a wall-clock time (`YYYY-MM-DDTHH:mm`), per the mode. */
export interface ScheduleValue {
  mode: ScheduleMode;
  opens: string;
  due: string;
}

export function scheduleValueOf(item: Pick<ChallengeItem, "opensAt" | "dueAt" | "schedulePrecision">, timeZone: string): ScheduleValue {
  const mode = scheduleModeOf(item);
  const read = (iso: string | null | undefined) => (!iso ? "" : mode === "datetime" ? instantToWallClock(iso, timeZone) : instantToDateKey(iso, timeZone));
  return { mode, opens: read(item.opensAt), due: read(item.dueAt) };
}

export function sameSchedule(a: ScheduleValue, b: ScheduleValue): boolean {
  if (a.mode !== b.mode) return false;
  return a.mode === "none" || (a.opens === b.opens && a.due === b.due);
}

/** `null` when the schedule reads fine; otherwise which problem to show. */
export function scheduleProblem(value: ScheduleValue): "order" | null {
  if (value.mode === "none" || !value.opens || !value.due) return null;
  return value.due < value.opens ? "order" : null;
}

/**
 * The PATCH keys for a schedule. Whole days and precise times are never mixed in
 * one request, and "no schedule" is sent as two explicit nulls so an old window
 * is actually cleared rather than left in place.
 */
export function scheduleBody(value: ScheduleValue, timeZone: string): Record<string, string | null> {
  if (value.mode === "none") return { opensOn: null, dueOn: null };
  if (value.mode === "date") return { opensOn: value.opens || null, dueOn: value.due || null };
  return {
    opensAt: value.opens ? wallClockToInstant(value.opens, timeZone) : null,
    dueAt: value.due ? wallClockToInstant(value.due, timeZone) : null,
  };
}

/**
 * An item's optional schedule: none, whole days, or a date and time. Nothing
 * here ever blocks recording an answer — a due date is a reminder and a place
 * in the agenda, not a lock.
 */
export function ItemScheduleFields({
  value,
  onChange,
  timeZone,
  disabled = false,
}: {
  value: ScheduleValue;
  onChange: (next: ScheduleValue) => void;
  timeZone: string;
  disabled?: boolean;
}) {
  const t = useTranslations("itemSchedule");
  const problem = scheduleProblem(value);
  const inputType = value.mode === "datetime" ? "datetime-local" : "date";

  function switchMode(mode: ScheduleMode) {
    if (mode === value.mode) return;
    // Carry the day across when moving between whole days and date-and-time.
    const toDay = (text: string) => text.slice(0, 10);
    if (mode === "none") onChange({ mode, opens: "", due: "" });
    else if (mode === "date") onChange({ mode, opens: toDay(value.opens), due: toDay(value.due) });
    else onChange({ mode, opens: value.opens ? `${toDay(value.opens)}T09:00` : "", due: value.due ? `${toDay(value.due)}T18:00` : "" });
  }

  return (
    <Field label={t("label")} hint={t("hint")} plain>
      <SelectableCards
        value={value.mode}
        onChange={switchMode}
        disabled={disabled}
        columns={3}
        options={[
          { value: "none", label: t("none"), hint: t("noneHint") },
          { value: "date", label: t("date"), hint: t("dateHint") },
          { value: "datetime", label: t("datetime"), hint: t("datetimeHint") },
        ]}
      />
      {value.mode !== "none" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={t("opens")} optional>
            <input className={inputClass} type={inputType} value={value.opens} disabled={disabled} onChange={(event) => onChange({ ...value, opens: event.target.value })} />
          </Field>
          <Field label={t("due")} optional error={problem === "order" ? t("errOrder") : null}>
            <input className={inputClass} type={inputType} min={value.opens || undefined} value={value.due} disabled={disabled} onChange={(event) => onChange({ ...value, due: event.target.value })} />
          </Field>
          <p className="text-xs leading-5 text-[var(--muted)] sm:col-span-2">
            {t("neverBlocks")}{value.mode === "datetime" ? ` ${t("zoneNote", { zone: timeZone })}` : ""}
          </p>
        </div>
      ) : null}
    </Field>
  );
}
