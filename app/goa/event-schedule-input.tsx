"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { type EventForm, eventFormProblem, knownTimeZones } from "./schedule";
import { Field, inputClass, Toggle } from "./ui";

/**
 * An item's own date — a match's day, a screening. "Add date" opens a full-width date; "End date" is
 * an optional extra row; the "Include time" switch puts a time beside each date and only then asks
 * for a time zone. The inputs carry no visible captions — a date picker, a time picker and a zone
 * list explain themselves — but each keeps an accessible name. It is information about the item: it
 * never opens or closes anything for answering.
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
  // The zones this browser knows, plus the one in use even if it isn't among them.
  const zones = useMemo(() => {
    const known = knownTimeZones();
    return value.timeZone && known.length && !known.includes(value.timeZone) ? [value.timeZone, ...known] : known;
  }, [value.timeZone]);
  // "Add date" / "End date" open their fields before there is a value to show in them.
  const [adding, setAdding] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const problem = eventFormProblem(value);
  const showEnd = endOpen || Boolean(value.endDate);
  // Full width until the time is on; then each date has its time to the right (stacked on a phone).
  const rowClass = value.withTime ? "grid gap-3 sm:grid-cols-2" : "grid gap-3";

  if (!value.date && !adding) {
    // Collapsed it is one quiet button — a list of items shouldn't repeat a field label per row.
    return (
      <button
        type="button"
        disabled={disabled}
        aria-label={`${label}: ${t("add")}`}
        onClick={() => setAdding(true)}
        className="min-h-11 self-start rounded-xl border border-dashed border-[var(--line)] px-4 text-sm font-light text-[var(--muted)] transition hover:border-[var(--main-line)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        ＋ {t("add")}
      </button>
    );
  }

  return (
    <div role="group" aria-label={label} className="space-y-3 rounded-xl border border-[var(--line)] p-3.5">
      <div className={rowClass}>
        <Field label="">
          <input className={inputClass} type="date" aria-label={t("date")} value={value.date} disabled={disabled} onChange={(event) => onChange({ ...value, date: event.target.value })} />
        </Field>
        {value.withTime ? (
          <Field label="" error={problem === "time" ? t("errTime") : null}>
            <input className={inputClass} type="time" aria-label={t("time")} value={value.time} disabled={disabled} onChange={(event) => onChange({ ...value, time: event.target.value })} />
          </Field>
        ) : null}
      </div>

      {showEnd ? (
        <div className={rowClass}>
          <Field label="" error={problem === "endOrder" ? t("errEndOrder") : null}>
            <input className={inputClass} type="date" aria-label={t("endDate")} value={value.endDate} min={value.date || undefined} disabled={disabled} onChange={(event) => onChange({ ...value, endDate: event.target.value })} />
          </Field>
          {value.withTime ? (
            <Field label="">
              <input className={inputClass} type="time" aria-label={t("endTime")} value={value.endTime} disabled={disabled} onChange={(event) => onChange({ ...value, endTime: event.target.value })} />
            </Field>
          ) : null}
        </div>
      ) : null}

      {!disabled ? (
        showEnd ? (
          <button
            type="button"
            className="min-h-9 rounded-lg px-1 text-xs text-[var(--muted)] transition hover:text-[var(--ink)]"
            onClick={() => { setEndOpen(false); onChange({ ...value, endDate: "", endTime: "" }); }}
          >
            {t("removeEnd")}
          </button>
        ) : (
          <button
            type="button"
            className="min-h-9 rounded-lg px-1 text-sm font-light text-[var(--muted)] transition hover:text-[var(--ink)]"
            // Starts on the start date, so a same-day end (16:00–18:00) is just an end time away.
            onClick={() => { setEndOpen(true); onChange({ ...value, endDate: value.date }); }}
          >
            ＋ {t("addEnd")}
          </button>
        )
      ) : null}

      <Toggle checked={value.withTime} disabled={disabled} label={t("includeTime")} onChange={(withTime) => onChange({ ...value, withTime })} />

      {value.withTime ? (
        <Field label="" error={problem === "zone" ? t("errZone") : null}>
          {zones.length ? (
            <select className={inputClass} aria-label={t("zone")} value={value.timeZone} disabled={disabled} onChange={(event) => onChange({ ...value, timeZone: event.target.value })}>
              {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
            </select>
          ) : (
            <input className={inputClass} aria-label={t("zone")} value={value.timeZone} disabled={disabled} autoCapitalize="off" spellCheck={false} maxLength={100} onChange={(event) => onChange({ ...value, timeZone: event.target.value.trim() })} />
          )}
        </Field>
      ) : null}

      {!disabled ? (
        <button
          type="button"
          className="min-h-9 rounded-lg px-1 text-xs text-[var(--muted)] transition hover:text-[var(--ink)]"
          onClick={() => { setAdding(false); setEndOpen(false); onChange({ date: "", endDate: "", withTime: false, time: "", endTime: "", timeZone: value.timeZone }); }}
        >
          {t("clear")}
        </button>
      ) : null}
    </div>
  );
}
