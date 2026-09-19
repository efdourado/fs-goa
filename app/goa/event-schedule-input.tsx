"use client";

import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";

import { type EventForm, eventFormProblem, knownTimeZones } from "./schedule";
import { Field, inputClass, Toggle } from "./ui";

/**
 * An item's own date — a match's day, a screening. Just a date to start with (and an optional end
 * date); a switch adds the time of day. It is information about the item: it never opens or closes
 * anything for answering.
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
  // "Add date" opens the fields before there is a date to show in them.
  const [adding, setAdding] = useState(false);
  const problem = eventFormProblem(value);

  if (!value.date && !adding) {
    return (
      <Field label={label} optional plain>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setAdding(true)}
          className="min-h-11 self-start rounded-xl border border-dashed border-[var(--line)] px-4 text-sm font-light text-[var(--muted)] transition hover:border-[var(--main-line)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          ＋ {t("add")}
        </button>
      </Field>
    );
  }

  return (
    <Field label={label} optional plain>
      <div className="space-y-3 rounded-xl border border-[var(--line)] p-3.5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("date")}>
            <input className={inputClass} type="date" value={value.date} disabled={disabled} onChange={(event) => onChange({ ...value, date: event.target.value })} />
          </Field>
          <Field label={t("endDate")} optional error={problem === "endOrder" ? t("errEndOrder") : null}>
            <input className={inputClass} type="date" value={value.endDate} min={value.date || undefined} disabled={disabled} onChange={(event) => onChange({ ...value, endDate: event.target.value })} />
          </Field>
        </div>
        <Toggle checked={value.withTime} disabled={disabled} label={t("includeTime")} onChange={(withTime) => onChange({ ...value, withTime })} />
        {value.withTime ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("time")} error={problem === "time" ? t("errTime") : null}>
                <input className={inputClass} type="time" value={value.time} disabled={disabled} onChange={(event) => onChange({ ...value, time: event.target.value })} />
              </Field>
              <Field label={t("endTime")} optional>
                <input className={inputClass} type="time" value={value.endTime} disabled={disabled} onChange={(event) => onChange({ ...value, endTime: event.target.value })} />
              </Field>
            </div>
            <Field label={t("zone")} hint={t("zoneHint")} error={problem === "zone" ? t("errZone") : null}>
              <input
                className={inputClass}
                list={zones.length ? zoneListId : undefined}
                value={value.timeZone}
                disabled={disabled}
                autoCapitalize="off"
                spellCheck={false}
                maxLength={100}
                onChange={(event) => onChange({ ...value, timeZone: event.target.value.trim() })}
              />
              {zones.length ? <datalist id={zoneListId}>{zones.map((zone) => <option key={zone} value={zone} />)}</datalist> : null}
            </Field>
          </div>
        ) : null}
        {!disabled ? (
          <button
            type="button"
            className="min-h-9 rounded-lg px-1 text-xs text-[var(--muted)] transition hover:text-[var(--ink)]"
            onClick={() => { setAdding(false); onChange({ date: "", endDate: "", withTime: false, time: "", endTime: "", timeZone: value.timeZone }); }}
          >
            {t("clear")}
          </button>
        ) : null}
      </div>
    </Field>
  );
}
