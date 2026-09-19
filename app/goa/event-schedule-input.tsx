"use client";

import { useTranslations } from "next-intl";
import { useId, useMemo } from "react";

import { type EventForm, eventFormProblem, knownTimeZones } from "./schedule";
import { Field, inputClass } from "./ui";

/**
 * "When does it happen?" for an item of a library — a match's kickoff, a screening.
 * Date · Time · Time zone, and an optional end time. Leave the time empty when only
 * the day is known. This is a fact about the item, not a rule for answering: it never
 * opens or closes anything.
 */
export function EventScheduleInput({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: EventForm;
  onChange: (next: EventForm) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("eventSchedule");
  const zoneListId = useId();
  const zones = useMemo(() => knownTimeZones(), []);
  const problem = eventFormProblem(value);
  const hasDate = Boolean(value.date);

  return (
    <Field label={label} hint={t("hint")} optional plain>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("date")}>
          <input className={inputClass} type="date" value={value.date} disabled={disabled} onChange={(event) => onChange({ ...value, date: event.target.value })} />
        </Field>
        <Field label={t("time")} optional>
          <input className={inputClass} type="time" value={value.time} disabled={disabled || !hasDate} onChange={(event) => onChange({ ...value, time: event.target.value, endTime: event.target.value ? value.endTime : "" })} />
        </Field>
        <Field label={t("endTime")} optional error={problem === "endOrder" ? t("errEndOrder") : problem === "endWithoutTime" ? t("errEndWithoutTime") : null}>
          <input className={inputClass} type="time" value={value.endTime} disabled={disabled || !value.time} min={value.time || undefined} onChange={(event) => onChange({ ...value, endTime: event.target.value })} />
        </Field>
      </div>
      <Field label={t("zone")} hint={t("zoneHint")} error={problem === "zone" ? t("errZone") : null} className="mt-3">
        <input
          className={inputClass}
          list={zones.length ? zoneListId : undefined}
          value={value.timeZone}
          disabled={disabled || !hasDate}
          autoCapitalize="off"
          spellCheck={false}
          maxLength={100}
          onChange={(event) => onChange({ ...value, timeZone: event.target.value.trim() })}
        />
        {zones.length ? <datalist id={zoneListId}>{zones.map((zone) => <option key={zone} value={zone} />)}</datalist> : null}
      </Field>
      {hasDate && !disabled ? (
        <button type="button" className="mt-2 min-h-9 self-start rounded-lg px-1 text-xs text-[var(--muted)] transition hover:text-[var(--ink)]" onClick={() => onChange({ date: "", time: "", endTime: "", timeZone: value.timeZone })}>
          {t("clear")}
        </button>
      ) : null}
    </Field>
  );
}
