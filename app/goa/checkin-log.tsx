"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  addDays,
  amountFromPosition,
  checkAmount,
  dayList,
  monthCells,
  monthsIn,
  overTotal,
  pace,
  streak,
  sumAll,
  sumBefore,
  weekStreak,
} from "./checkin-days";
import { useGoaFormat } from "./format";
import { Segmented } from "./Segmented";
import type { ChallengeField, Entry, Id } from "./types";
import { Button, cx, inputClass, labelClass, sectionLabelClass, StatusMessage } from "./ui";
import { valuesAsRecord } from "./utils";

/** One logged day: the entry behind it and, for a counter, the number it holds. */
export interface LogRecord {
  entry: Entry;
  value: number | null;
}

/** What turns the log from "which days did I check in" into "how much, and where does that leave me". */
export interface LogCounter {
  field: ChallengeField;
  /** Optional text fields saved alongside the number (a note on the day). */
  notes: ChallengeField[];
  /** The book's page count — draws the progress bar, "p. X de N" and the pace. Null for any other counter. */
  total: number | null;
  /** The window an even pace is measured over; no `paceTo` means no pace. */
  paceFrom: string;
  paceTo: string | null;
  onSave: (day: string, values: Record<Id, unknown>, entry?: Entry) => Promise<void>;
  onDelete?: (entry: Entry) => Promise<void>;
  /** Offered once the total is reached and the book isn't marked finished yet. */
  onFinish?: () => void;
}

type LogView = "strip" | "month";
type EntryMode = "amount" | "position";
const VIEW_KEY = "goa.checkinLog.view";

function readStoredView(): LogView | null {
  try {
    const stored = window.localStorage.getItem(VIEW_KEY);
    return stored === "strip" || stored === "month" ? stored : null;
  } catch {
    return null;
  }
}

// Read through an external store (like the theme) so the server render and the first client render agree.
const viewListeners = new Set<() => void>();
function subscribeView(listener: () => void) {
  viewListeners.add(listener);
  return () => { viewListeners.delete(listener); };
}

function storeView(view: LogView) {
  try { window.localStorage.setItem(VIEW_KEY, view); } catch { /* private mode: the choice just isn't remembered */ }
  viewListeners.forEach((listener) => listener());
}

const isWeekStart = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay() === 1;

/**
 * The Today tab's check-in log: every day of the challenge (or the book) as a
 * chip — filled with what you logged, dashed when you didn't — with a month
 * calendar one tap away. Picking a day hands it to `onSelectDay`, which is the
 * date the forms below save to. A counter (pages, km…) also gets a progress
 * bar built from the days themselves and its own editor; anything else keeps
 * the challenge's usual form, passed in as `children`.
 */
export function CheckinLog({
  from,
  to,
  today,
  deadline,
  records,
  selectedDay,
  onSelectDay,
  counter,
  canEdit,
  unavailableMessage,
  openEnded = false,
  streakBy = "day",
  children,
}: {
  from: string;
  to: string;
  today: string;
  /** Marked on the strip — the book's due day, or the challenge's last. */
  deadline?: string | null;
  records: ReadonlyMap<string, LogRecord>;
  selectedDay: string;
  onSelectDay: (day: string) => void;
  counter?: LogCounter | null;
  canEdit: boolean;
  /** No dates at all: the strip is just "since the first check-in", so the count never reads as a target. */
  openEnded?: boolean;
  /** Days for a daily habit; weeks for something done a few times a week (a workout). */
  streakBy?: "day" | "week";
  unavailableMessage?: string | null;
  children?: ReactNode;
}) {
  const t = useTranslations("checkinLog");
  const storedView = useSyncExternalStore(subscribeView, () => readStoredView() ?? "strip", () => "strip" as const);
  // Private browsing can refuse to store it — the choice still holds for this visit.
  const [pickedView, setPickedView] = useState<LogView | null>(null);
  const view = pickedView ?? storedView;
  const [mode, setMode] = useState<EntryMode>("amount");
  // What the editor would save right now — drawn as a striped segment on the bar before it's saved.
  const [draft, setDraft] = useState<number | null>(null);
  // Survives the reload a save triggers (the editor remounts with the new entry), cleared on another day.
  const [notice, setNotice] = useState<string | null>(null);

  const days = useMemo(() => dayList(from, to), [from, to]);
  const values = useMemo(() => {
    const map = new Map<string, number>();
    for (const [day, record] of records) if (record.value !== null) map.set(day, record.value);
    return map;
  }, [records]);
  const logged = useMemo(() => new Set(records.keys()), [records]);
  const pastDays = days.filter((day) => day <= today).length;
  const loggedInRange = days.filter((day) => logged.has(day)).length;
  const firstLogged = useMemo(() => [...logged].sort()[0] ?? null, [logged]);
  const formatDate = useGoaFormat();
  const strong = (chunks: ReactNode) => <strong className="font-medium tabular-nums text-[var(--ink)]">{chunks}</strong>;

  function select(day: string) {
    if (day > today) return;
    if (day !== selectedDay) {
      setNotice(null);
      setDraft(null);
    }
    onSelectDay(day);
  }

  function changeView(next: LogView) {
    setPickedView(next);
    storeView(next);
  }

  return (
    <div className="space-y-7">
      {counter?.total ? (
        <BookProgress
          counter={counter}
          values={values}
          today={today}
          selectedDay={selectedDay}
          draft={draft}
          onSelect={select}
        />
      ) : null}

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h3 className={sectionLabelClass}>{t("title")}</h3>
            <p className="text-xs text-[var(--muted)]">
              {firstLogged === null && openEnded
                ? t("loggedNone")
                : openEnded
                  ? t.rich("loggedSince", { logged: loggedInRange, date: formatDate.date(firstLogged), b: strong })
                  : t.rich("loggedOf", { logged: loggedInRange, days: pastDays, b: strong })}
              {" · "}
              {streakBy === "week"
                ? t.rich("streakWeeks", { streak: weekStreak(logged, today), b: strong })
                : t.rich("streakDays", { streak: streak(logged, today), b: strong })}
              {counter && !counter.total && values.size ? <> · <TotalSoFar total={sumAll(values)} /></> : null}
            </p>
          </div>
          <Segmented
            className="w-40 flex-none"
            ariaLabel={t("viewAria")}
            value={view}
            onChange={changeView}
            options={[{ value: "strip", label: t("viewStrip") }, { value: "month", label: t("viewMonth") }]}
          />
        </div>
        {view === "strip" ? (
          <DayStrip days={days} today={today} deadline={deadline} records={records} selectedDay={selectedDay} onSelect={select} />
        ) : (
          <MonthGrid from={from} to={to} today={today} deadline={deadline} records={records} values={values} selectedDay={selectedDay} onSelect={select} />
        )}
      </div>

      {counter ? (
        <CounterEditor
          key={`${selectedDay}-${records.get(selectedDay)?.entry.id ?? "new"}-${records.get(selectedDay)?.entry.updatedAt ?? ""}`}
          counter={counter}
          day={selectedDay}
          today={today}
          record={records.get(selectedDay)}
          values={values}
          mode={mode}
          onMode={setMode}
          onDraft={setDraft}
          canEdit={canEdit}
          unavailableMessage={unavailableMessage}
          notice={notice}
          onNotice={setNotice}
        />
      ) : (
        <div className="border-t border-[var(--line)] pt-6">
          <DayHeading day={selectedDay} today={today} state={logged.has(selectedDay) ? t("stateDone") : selectedDay === today ? t("stateEmptyToday") : t("stateEmpty")} />
          {children}
        </div>
      )}
    </div>
  );
}

function TotalSoFar({ total }: { total: number }) {
  const t = useTranslations("checkinLog");
  const nf = useFormatter();
  return <>{t.rich("totalSoFar", { total: nf.number(total, { maximumFractionDigits: 2 }), b: (chunks) => <strong className="font-medium tabular-nums text-[var(--ink)]">{chunks}</strong> })}</>;
}

/** "Hoje, 28 de setembro" / "Ontem, …" / "Terça-feira, 16 de setembro". */
function useDayLabel() {
  const t = useTranslations("checkinLog");
  const f = useGoaFormat();
  return (day: string, today: string) => {
    const short = f.date(day, { day: "numeric", month: "long" });
    if (day === today) return t("dayToday", { date: short });
    if (day === addDays(today, -1)) return t("dayYesterday", { date: short });
    const long = f.date(day, { weekday: "long", day: "numeric", month: "long" });
    return long.charAt(0).toUpperCase() + long.slice(1);
  };
}

function DayHeading({ day, today, state }: { day: string; today: string; state: string }) {
  const dayLabel = useDayLabel();
  return (
    <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h3 className="text-xl font-light tracking-[-0.03em]">{dayLabel(day, today)}</h3>
      <span className="text-xs text-[var(--muted)]">{state}</span>
    </div>
  );
}

function useChipNumber() {
  const nf = useFormatter();
  return (value: number) => value >= 1000
    ? nf.number(value, { notation: "compact", maximumFractionDigits: 1 })
    : nf.number(value, { maximumFractionDigits: 1 });
}

function DayStrip({
  days,
  today,
  deadline,
  records,
  selectedDay,
  onSelect,
}: {
  days: string[];
  today: string;
  deadline?: string | null;
  records: ReadonlyMap<string, LogRecord>;
  selectedDay: string;
  onSelect: (day: string) => void;
}) {
  const t = useTranslations("checkinLog");
  const f = useGoaFormat();
  const dayLabel = useDayLabel();
  const chipNumber = useChipNumber();
  const scroller = useRef<HTMLDivElement>(null);
  // Keep the picked day in view — scrolled inside the strip only, so the page itself never jumps.
  useEffect(() => {
    const strip = scroller.current;
    const chip = strip?.querySelector<HTMLElement>(`[data-day="${selectedDay}"]`);
    if (!strip || !chip) return;
    strip.scrollLeft = chip.offsetLeft - strip.clientWidth / 2 + chip.clientWidth / 2;
  }, [selectedDay, days]);

  return (
    <div>
      <div ref={scroller} className="relative flex gap-1 overflow-x-auto px-0.5 pb-2.5 pt-1 [scrollbar-width:thin]" role="group" aria-label={t("stripAria")}>
        {days.map((day, index) => {
          const record = records.get(day);
          const future = day > today;
          const isDeadline = day === deadline;
          const picked = day === selectedDay;
          const state = record ? "done" : future ? "future" : "missed";
          const label = dayLabel(day, today);
          const aria = record
            ? record.value !== null ? t("dayAriaValue", { date: label, value: chipNumber(record.value) }) : t("dayAriaDone", { date: label })
            : future ? t("dayAriaFuture", { date: label }) : t("dayAriaMissed", { date: label });
          return (
            <div key={day} className="flex flex-none">
              {index > 0 && isWeekStart(day) ? <span className="w-1.5 flex-none" aria-hidden="true" /> : null}
              <button
                type="button"
                data-day={day}
                disabled={future}
                aria-pressed={picked}
                aria-label={aria}
                onClick={() => onSelect(day)}
                className={cx(
                  "grid w-11 flex-none justify-items-center gap-1.5 rounded-[14px] border pb-2.5 pt-2 transition",
                  picked ? "border-[var(--main)] bg-[var(--main-soft)]" : "border-transparent enabled:hover:bg-[var(--wash)]",
                  future && "cursor-default opacity-45",
                )}
              >
                <span className="text-[10px] uppercase tracking-[0.06em] text-[var(--muted)]">{f.date(day, { weekday: "short" }).replace(".", "")}</span>
                <span className={cx("text-[13px] tabular-nums", day === today && "font-semibold text-[var(--main-strong)]")}>{Number(day.slice(8))}</span>
                <span
                  className={cx(
                    "grid h-8 w-8 place-items-center rounded-full text-[11px] font-medium tabular-nums",
                    state === "done" && "bg-[var(--main)] text-white",
                    state === "missed" && day !== today && "border-[1.5px] border-dashed border-[var(--line)] text-[var(--muted)]",
                    state === "missed" && day === today && "border-[1.5px] border-[var(--main)] text-[var(--main)]",
                    state === "future" && (isDeadline ? "border-[1.5px] border-[var(--main-2)] text-[var(--main-2)]" : "bg-[var(--wash)]"),
                  )}
                  aria-hidden="true"
                >
                  {record ? (record.value !== null ? chipNumber(record.value) : <CheckMark />) : future ? (isDeadline ? <FlagMark /> : "") : "+"}
                </span>
              </button>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-[var(--muted)]">
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[var(--main)]" />{t("legendDone")}</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full border-[1.5px] border-dashed border-[var(--muted)]" />{t("legendMissed")}</span>
        {deadline ? <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full border-[1.5px] border-[var(--main-2)]" />{t("legendDeadline")}</span> : null}
      </div>
    </div>
  );
}

function MonthGrid({
  from,
  to,
  today,
  deadline,
  records,
  values,
  selectedDay,
  onSelect,
}: {
  from: string;
  to: string;
  today: string;
  deadline?: string | null;
  records: ReadonlyMap<string, LogRecord>;
  values: ReadonlyMap<string, number>;
  selectedDay: string;
  onSelect: (day: string) => void;
}) {
  const t = useTranslations("checkinLog");
  const f = useGoaFormat();
  const dayLabel = useDayLabel();
  const chipNumber = useChipNumber();
  const max = Math.max(1, ...values.values());
  // Sunday-first initials, from a known Sunday (2026-09-06) so they follow the locale.
  const weekdays = Array.from({ length: 7 }, (_, index) => f.date(addDays("2026-09-06", index), { weekday: "narrow" }));
  return (
    <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
      {monthsIn(from, to).map((month) => (
        <div key={month} className="w-full max-w-sm">
          <h4 className="mb-2 text-[13px] font-medium first-letter:uppercase">{f.date(`${month}-01`, { month: "long", year: "numeric" })}</h4>
          <div className="grid grid-cols-7 gap-1">
            {weekdays.map((weekday, index) => <span key={index} className="text-center text-[10px] uppercase text-[var(--muted)]" aria-hidden="true">{weekday}</span>)}
            {monthCells(month).map((day, index) => {
              if (!day) return <span key={`blank-${index}`} aria-hidden="true" />;
              const inRange = day >= from && day <= to;
              const record = records.get(day);
              const future = day > today;
              const value = record?.value ?? null;
              // Darker green for a bigger day; a check-in without a number gets the middle shade.
              const heat = record ? (value !== null ? 40 + Math.round((value / max) * 60) : 70) : 0;
              const label = dayLabel(day, today);
              return (
                <button
                  key={day}
                  type="button"
                  disabled={!inRange || future}
                  aria-pressed={day === selectedDay}
                  aria-label={record ? (value !== null ? t("dayAriaValue", { date: label, value: chipNumber(value) }) : t("dayAriaDone", { date: label })) : future ? t("dayAriaFuture", { date: label }) : t("dayAriaMissed", { date: label })}
                  onClick={() => onSelect(day)}
                  className={cx(
                    "grid aspect-square content-center justify-items-center rounded-[10px] border text-xs leading-tight transition",
                    // Outside the book's window (or the challenge): kept as a faint number so the month still reads as a calendar.
                    !inRange && "cursor-default border-transparent text-[var(--muted)] opacity-35",
                    inRange && future && cx("cursor-default opacity-40", day !== deadline && "border-transparent"),
                    inRange && !future && !record && (day === today ? "border-[1.5px] border-[var(--main)] text-[var(--main)]" : "border-dashed border-[var(--line)] text-[var(--muted)]"),
                    record && "border-transparent",
                    record && heat >= 60 ? "text-white" : record ? "text-[var(--main-strong)]" : undefined,
                    day === deadline && "border-[1.5px] border-[var(--main-2)] text-[var(--main-2)] opacity-100",
                    day === selectedDay && "outline outline-2 outline-offset-1 outline-[var(--ink)]",
                  )}
                  style={record ? { background: `color-mix(in srgb, var(--main) ${heat}%, var(--main-soft))` } : undefined}
                >
                  <span className="tabular-nums">{Number(day.slice(8))}</span>
                  {value !== null ? <span className="text-[10px] tabular-nums opacity-90">{chipNumber(value)}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * How far into the book you are, drawn from the check-ins themselves: one
 * segment per logged day, sized by that day's pages, and a coral mark where an
 * even pace to the deadline would have you by tonight.
 */
function BookProgress({
  counter,
  values,
  today,
  selectedDay,
  draft,
  onSelect,
}: {
  counter: LogCounter;
  values: ReadonlyMap<string, number>;
  today: string;
  selectedDay: string;
  draft: number | null;
  onSelect: (day: string) => void;
}) {
  const t = useTranslations("checkinLog");
  const f = useGoaFormat();
  const nf = useFormatter();
  const total = counter.total ?? 0;
  const done = sumAll(values);
  const withDraft = new Map(values);
  if (draft !== null) withDraft.set(selectedDay, draft);
  const segments = [...withDraft.entries()].filter(([, value]) => value > 0).sort(([a], [b]) => a.localeCompare(b));
  const shown = sumAll(withDraft);
  const scale = Math.max(total, shown);
  const progress = pace({ total, from: counter.paceFrom, to: counter.paceTo, today, done, loggedToday: values.has(today) });
  const percent = Math.min(100, Math.round((done / total) * 100));
  const finished = done >= total;
  const page = (value: number) => nf.number(value, { maximumFractionDigits: 0 });

  return (
    <div className="space-y-3.5">
      <div className="flex items-end justify-between gap-4">
        <p className="text-xs text-[var(--muted)]">{t("bookLabel")}</p>
        <div className="text-right">
          <p className="text-3xl font-light leading-none tracking-[-0.04em] tabular-nums">
            {t("pageShort", { page: page(done) })} <small className="text-sm tracking-normal text-[var(--muted)]">{t("pageOf", { total: page(total) })}</small>
          </p>
          <p className="mt-1 text-xs text-[var(--main-strong)]">{t("percentRead", { percent })}</p>
        </div>
      </div>
      <div>
        <div className="relative h-8 rounded-lg bg-[var(--wash)]" role="img" aria-label={t("progressAria", { page: page(done), total: page(total), percent })}>
          <div className="flex h-full gap-0.5 overflow-hidden rounded-lg" style={{ width: `${Math.min(100, (shown / scale) * 100)}%` }}>
            {segments.map(([day, value], index) => {
              const ghost = draft !== null && day === selectedDay && draft !== values.get(day);
              return (
                <button
                  key={day}
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  title={`${f.date(day)}: ${page(value)}`}
                  onClick={() => onSelect(day)}
                  className={cx("h-full min-w-[3px] cursor-pointer transition-[filter] hover:brightness-125", day === selectedDay && "shadow-[inset_0_0_0_2px_var(--ink)]")}
                  style={{
                    flex: `0 0 calc(${(value / shown) * 100}% - 2px)`,
                    background: ghost
                      ? "repeating-linear-gradient(135deg, var(--main-line) 0 5px, var(--main-soft) 5px 10px)"
                      : index % 2 ? "color-mix(in srgb, var(--main) 80%, var(--paper))" : "var(--main)",
                  }}
                />
              );
            })}
          </div>
          {progress ? (() => {
            const at = Math.min(100, (progress.expected / scale) * 100);
            // Centred under its mark, except near either end, where it hangs inward so it never spills out of the box.
            const label = at > 80 ? "right-0" : at < 20 ? "left-0" : "left-1/2 -translate-x-1/2";
            return (
              <span
                className="absolute -bottom-1.5 -top-1.5 w-0.5 rounded bg-[var(--main-2)]"
                style={{ left: `calc(${at}% - 1px)` }}
                aria-hidden="true"
              >
                <span className={cx("absolute top-[calc(100%+4px)] whitespace-nowrap text-[11px] text-[var(--main-2)]", label)}>{t("paceMark", { page: page(progress.expected) })}</span>
              </span>
            );
          })() : null}
        </div>
        <div className={cx("flex justify-between text-[11px] tabular-nums text-[var(--muted)]", progress ? "mt-6" : "mt-1.5")}>
          <span>{t("pageShort", { page: 1 })}</span>
          <span>{t("pageShort", { page: page(total) })}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-[var(--muted)]">
        {finished ? (
          <span className="rounded-full bg-[var(--ok-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--ok)]">{t("finished")}</span>
        ) : progress ? (
          <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-medium", progress.ahead >= 0 ? "bg-[var(--ok-soft)] text-[var(--ok)]" : "bg-[var(--warn-soft)] text-[var(--warn)]")}>
            {progress.ahead === 0 ? t("onPace") : progress.ahead > 0 ? t("ahead", { count: progress.ahead }) : t("behind", { count: -progress.ahead })}
          </span>
        ) : null}
        {!finished ? (
          <span>
            {progress?.perDay && counter.paceTo
              ? t.rich("leftPerDay", { left: page(total - done), perDay: page(progress.perDay), date: f.date(counter.paceTo), b: (chunks) => <strong className="font-medium tabular-nums text-[var(--ink)]">{chunks}</strong> })
              : t.rich("left", { left: page(total - done), b: (chunks) => <strong className="font-medium tabular-nums text-[var(--ink)]">{chunks}</strong> })}
          </span>
        ) : null}
        {finished && counter.onFinish ? (
          <Button variant="secondary" className="min-h-9 px-3 text-xs" onClick={counter.onFinish}>{t("markFinished")}</Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The selected day's number, two ways: "how much today" with a stepper and
 * shortcuts, or "where I stopped" (a page, a running total) worked out into the
 * day's amount from everything logged before it. Only the day's amount is ever
 * stored, so both modes save the same entry.
 */
function CounterEditor({
  counter,
  day,
  today,
  record,
  values,
  mode,
  onMode,
  onDraft,
  canEdit,
  unavailableMessage,
  notice,
  onNotice,
}: {
  counter: LogCounter;
  day: string;
  today: string;
  record?: LogRecord;
  values: ReadonlyMap<string, number>;
  mode: EntryMode;
  onMode: (mode: EntryMode) => void;
  onDraft: (amount: number | null) => void;
  canEdit: boolean;
  unavailableMessage?: string | null;
  notice: string | null;
  onNotice: (notice: string | null) => void;
}) {
  const t = useTranslations("checkinLog");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const nf = useFormatter();
  const { field, notes, total } = counter;
  const isBook = Boolean(total);
  const saved = record?.value ?? null;
  const before = sumBefore(values, day);
  const initial = saved === null ? "" : String(mode === "amount" ? saved : before + saved);
  const [raw, setRaw] = useState(initial);
  const [noteValues, setNoteValues] = useState<Record<Id, string>>(() => {
    const stored = record ? valuesAsRecord(record.entry.values) : {};
    return Object.fromEntries(notes.map((note) => [note.id as Id, typeof stored[note.id as Id] === "string" ? String(stored[note.id as Id]) : ""]));
  });
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typed = raw.trim() === "" ? null : Number(raw.replace(",", "."));
  const amount = typed === null || !Number.isFinite(typed) ? null : mode === "amount" ? typed : amountFromPosition(typed, before);
  const problem = checkAmount({ amount, mode, before, field });
  const exceeds = !problem && amount !== null && overTotal(values, day, amount, total);
  const storedNotes = record ? valuesAsRecord(record.entry.values) : {};
  const notesChanged = notes.some((note) => (noteValues[note.id as Id] ?? "") !== String(storedNotes[note.id as Id] ?? ""));
  const unchanged = saved !== null && amount === saved && !notesChanged;
  const step = field.config?.step && field.config.step > 0 ? field.config.step : 1;
  // Shortcuts in whole units: a 0.5 step still jumps by 1, 5 and 10.
  const unit = Math.max(1, step);
  const quick = isBook ? [5, 10, 20, 30] : [unit, unit * 5, unit * 10];
  const format = (value: number) => nf.number(value, { maximumFractionDigits: 2 });
  const shown = (value: number) => (isBook ? t("pagesCount", { count: value, formatted: format(value) }) : format(value));

  useEffect(() => {
    onDraft(!problem && amount !== null ? amount : null);
  }, [amount, problem, onDraft]);

  function switchMode(next: EntryMode) {
    if (next === mode) return;
    // Carry what's typed across: "25 pages today" becomes "stopped on 90", and back.
    if (amount !== null) setRaw(String(next === "amount" ? amount : before + amount));
    onMode(next);
  }

  function nudge(delta: number) {
    const current = typed !== null && Number.isFinite(typed) ? typed : mode === "position" ? before : 0;
    const next = Math.max(0, Number((current + delta).toFixed(4)));
    setRaw(next === 0 ? "" : String(next));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (problem || amount === null || unchanged || !canEdit) return;
    setBusy(true);
    setError(null);
    try {
      const noteEntries = notes.map((note) => [note.id as Id, noteValues[note.id as Id] ?? ""] as const);
      await counter.onSave(day, { ...Object.fromEntries(noteEntries), [field.id as Id]: amount }, record?.entry);
      onNotice(t(record ? "savedChange" : "savedNew", { value: shown(amount), date: f.date(day) }));
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!record || !counter.onDelete) return;
    setBusy(true);
    setError(null);
    try {
      await counter.onDelete(record.entry);
      onNotice(t("removed", { date: f.date(day) }));
    } catch (cause) {
      setError(f.error(cause));
      setBusy(false);
      setConfirming(false);
    }
  }

  const problemText = problem && problem.code !== "empty"
    ? problem.code === "belowStart"
      ? t(isBook ? "errorBelowStartBook" : "errorBelowStart", { before: format(problem.before) })
      : problem.code === "aboveMax"
        ? t("errorAboveMax", { max: format(problem.max) })
        : problem.code === "offStep"
          ? t("errorOffStep", { step: format(problem.step) })
          : t(problem.code === "notWhole" ? "errorNotWhole" : "errorNotPositive")
    : null;
  const after = amount !== null && !problem ? sumAll(values) - (saved ?? 0) + amount : null;
  const saveLabel = busy
    ? tc("saving")
    : amount === null || problem
      ? (record ? tc("saveChanges") : t("saveIdle"))
      : unchanged
        ? t("noChanges")
        : record ? t("saveChange", { value: shown(amount) }) : t("saveNew", { value: shown(amount) });
  const disabled = !canEdit || busy;

  return (
    <form className="space-y-4 border-t border-[var(--line)] pt-6" onSubmit={submit} noValidate>
      <DayHeading
        day={day}
        today={today}
        state={saved !== null ? t("stateValue", { value: shown(saved) }) : day === today ? t("stateEmptyToday") : t("stateEmpty")}
      />
      <Segmented
        className="max-w-xs"
        ariaLabel={t("modeAria")}
        value={mode}
        onChange={switchMode}
        options={[{ value: "amount", label: field.label }, { value: "position", label: isBook ? t("modePositionBook") : t("modePosition") }]}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="inline-flex overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--paper)] focus-within:border-[var(--main)] focus-within:ring-4 focus-within:ring-[var(--main)]/18">
          <button type="button" className="w-11 cursor-pointer bg-[var(--wash)] text-xl text-[var(--muted)] hover:text-[var(--ink)] disabled:cursor-not-allowed" disabled={disabled} aria-label={t("decrease", { step: format(step) })} onClick={() => nudge(-step)}>−</button>
          <label className="sr-only" htmlFor="checkin-amount">{mode === "amount" ? field.label : isBook ? t("modePositionBook") : t("modePosition")}</label>
          <input
            id="checkin-amount"
            className="w-24 bg-transparent px-1 py-2 text-center text-2xl tabular-nums outline-none [appearance:textfield] disabled:text-[var(--muted)] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            type="number"
            inputMode={Number.isInteger(step) ? "numeric" : "decimal"}
            min={0}
            step={step}
            value={raw}
            disabled={disabled}
            onChange={(event) => { setRaw(event.target.value); setError(null); }}
          />
          <button type="button" className="w-11 cursor-pointer bg-[var(--wash)] text-xl text-[var(--muted)] hover:text-[var(--ink)] disabled:cursor-not-allowed" disabled={disabled} aria-label={t("increase", { step: format(step) })} onClick={() => nudge(step)}>+</button>
        </div>
        {mode === "amount" ? (
          <div className="flex flex-wrap gap-1.5">
            {quick.map((value) => (
              <button key={value} type="button" disabled={disabled} onClick={() => nudge(value)} className="min-h-8 cursor-pointer rounded-full border border-[var(--line)] bg-[var(--paper)] px-3 text-[13px] tabular-nums hover:border-[var(--main-line)] hover:text-[var(--main-strong)] disabled:cursor-not-allowed disabled:opacity-50">
                +{format(value)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <p className="min-h-5 text-[13px] text-[var(--muted)]" aria-live="polite">
        {problemText ? (
          <span className="text-[var(--danger)]">{problemText}</span>
        ) : after !== null && amount !== null ? (
          <>
            {mode === "position" ? <>{t.rich("positionResult", { value: shown(amount), b: (chunks) => <strong className="font-medium text-[var(--ink)]">{chunks}</strong> })} </> : null}
            {isBook
              ? t.rich("previewBook", { page: format(after), percent: Math.round((after / (total ?? 1)) * 100), b: (chunks) => <strong className="font-medium tabular-nums text-[var(--ink)]">{chunks}</strong> })
              : t.rich("previewTotal", { total: format(after), b: (chunks) => <strong className="font-medium tabular-nums text-[var(--ink)]">{chunks}</strong> })}
          </>
        ) : mode === "position" ? (
          isBook ? t("positionHintBook", { before: format(before) }) : t("positionHint", { before: format(before) })
        ) : null}
      </p>
      {exceeds ? <p className="rounded-xl bg-[var(--warn-soft)] px-3.5 py-2.5 text-[13px] text-[var(--warn)]">{t("overTotal", { total: format(total ?? 0) })}</p> : null}
      {notes.map((note) => (
        <div key={note.id}>
          <label className={labelClass} htmlFor={`checkin-note-${note.id}`}>{note.label}<small className="ml-2 font-light text-[var(--muted)]">{t("optional")}</small></label>
          <textarea
            id={`checkin-note-${note.id}`}
            className={inputClass}
            rows={note.config?.multiline ? 3 : 1}
            maxLength={note.config?.maxLength}
            value={noteValues[note.id as Id] ?? ""}
            disabled={disabled}
            onChange={(event) => setNoteValues((current) => ({ ...current, [note.id as Id]: event.target.value }))}
          />
        </div>
      ))}
      {!canEdit ? (
        <p className="rounded-xl border border-[var(--line)] bg-[var(--wash)] px-4 py-3 text-sm leading-6 text-[var(--muted)]">{unavailableMessage ?? t("readOnly")}</p>
      ) : confirming && record ? (
        <div className="flex flex-wrap items-center gap-2.5 rounded-xl bg-[var(--danger-soft)] px-3.5 py-2.5 text-[13px]">
          <span className="mr-auto">{t("removeConfirm", { date: f.date(day), value: shown(saved ?? 0) })}</span>
          <Button variant="danger" className="min-h-9 bg-[var(--paper)]" disabled={busy} onClick={remove}>{t("removeYes")}</Button>
          <Button variant="ghost" className="min-h-9" disabled={busy} onClick={() => setConfirming(false)}>{tc("cancel")}</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2.5">
          <Button type="submit" className="min-w-44" disabled={disabled || amount === null || Boolean(problem) || unchanged}>{saveLabel}<span aria-hidden="true">→</span></Button>
          {record && counter.onDelete ? <Button variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>{t("remove")}</Button> : null}
        </div>
      )}
      <StatusMessage error={error} success={error ? null : notice} />
    </form>
  );
}

function CheckMark() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FlagMark() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 14V2.5M4 3h7.5l-1.8 3 1.8 3H4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
