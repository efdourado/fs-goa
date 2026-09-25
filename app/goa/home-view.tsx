"use client";

import { useTranslations } from "next-intl";

import { Segmented } from "./Segmented";
import type { HomeSection, HomeView } from "./types";
import { CircleChevronIcon, cx, Toggle } from "./ui";

const BOTH: HomeSection[] = ["personal", "groups"];

/** How much each side of Home is used — what the automatic view is decided from. */
export interface HomeUsage {
  /** The person's own challenges, and how many of them are running. */
  personal: number;
  personalActive: number;
  /** Groups they belong to, and how many of their challenges are running. */
  groups: number;
  groupActive: number;
}

/**
 * The view Home draws: the person's saved choice, or — until they pick one — a separated Home that shows only the
 * side they use (solo-only → just theirs, group-only → just groups), busiest side first when they use both.
 */
export function resolveHomeView(saved: HomeView | null | undefined, usage: HomeUsage): HomeView {
  if (saved) return saved;
  const usesPersonal = usage.personal > 0;
  const usesGroups = usage.groups > 0;
  if (usesPersonal && !usesGroups) return { layout: "separated", order: ["personal", "groups"], hidden: ["groups"] };
  if (usesGroups && !usesPersonal) return { layout: "separated", order: ["groups", "personal"], hidden: ["personal"] };
  const order: HomeSection[] = usage.groupActive > usage.personalActive ? ["groups", "personal"] : ["personal", "groups"];
  return { layout: "separated", order, hidden: [] };
}

/** The sides a view leaves on Home, in order; a mixed view shows both. */
export function visibleSections(view: HomeView): HomeSection[] {
  return view.layout === "mixed" ? BOTH : view.order.filter((section) => !view.hidden.includes(section));
}

/** The panel under Home's heading where the person arranges the page; every change saves at once. */
export function HomeViewPanel({ view, automatic, onChange, onReset }: {
  view: HomeView;
  /** True while nothing is saved — the view shown is the automatic one. */
  automatic: boolean;
  onChange: (next: HomeView) => void;
  onReset: () => void;
}) {
  const t = useTranslations("dashboard.home");
  const tCard = useTranslations("dashboard.card");
  const label: Record<HomeSection, string> = { personal: t("sectionPersonal"), groups: t("sectionGroups") };

  function setHidden(section: HomeSection, hide: boolean) {
    const hidden = hide ? [...view.hidden, section] : view.hidden.filter((entry) => entry !== section);
    if (hidden.length >= BOTH.length) return;
    onChange({ ...view, hidden });
  }

  return (
    <div className="mb-8 rounded-[20px] border border-[var(--line)] bg-[var(--paper)] p-4 shadow-[var(--elevate-1)] sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-medium tracking-[-0.02em]">{t("viewTitle")}</h2>
        {automatic ? (
          <span className="text-xs text-[var(--muted)]">{t("automaticNow")}</span>
        ) : (
          <button type="button" onClick={onReset} className="cursor-pointer text-xs text-[var(--muted)] underline-offset-2 hover:text-[var(--ink)] hover:underline">{t("automatic")}</button>
        )}
      </div>

      <Segmented
        className="mt-4 max-w-sm"
        ariaLabel={t("layoutLabel")}
        value={view.layout}
        options={[{ value: "separated", label: t("separated") }, { value: "mixed", label: t("mixed") }]}
        onChange={(layout) => onChange({ ...view, layout })}
      />
      <p className="mt-2 text-sm text-[var(--muted)]">{view.layout === "mixed" ? t("mixedHint") : t("separatedHint")}</p>

      {view.layout === "separated" ? (
        <ol className="mt-4 divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {view.order.map((section, index) => {
            const shown = !view.hidden.includes(section);
            const lastShown = shown && view.hidden.length === BOTH.length - 1;
            return (
              <li key={section} className="flex min-h-14 items-center gap-3 py-2">
                <span className="w-5 text-sm tabular-nums text-[var(--muted)]">{index + 1}</span>
                <span className={cx("min-w-0 flex-1 text-sm", !shown && "text-[var(--muted)] line-through")}>{label[section]}</span>
                <button
                  type="button"
                  onClick={() => onChange({ ...view, order: [...view.order].reverse() })}
                  aria-label={index === 0 ? tCard("moveDown") : tCard("moveUp")}
                  title={index === 0 ? tCard("moveDown") : tCard("moveUp")}
                  className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-[var(--muted)] transition hover:bg-[var(--wash)] hover:text-[var(--ink)]"
                >
                  <CircleChevronIcon className="h-[18px] w-[18px]" dir={index === 0 ? "down" : "up"} />
                </button>
                <label className="flex items-center">
                  <span className="sr-only">{t("show", { section: label[section] })}</span>
                  <Toggle checked={shown} disabled={lastShown} onChange={(next) => setHidden(section, !next)} />
                </label>
              </li>
            );
          })}
        </ol>
      ) : null}
      {view.layout === "separated" && view.hidden.length ? <p className="mt-3 text-xs text-[var(--muted)]">{t("lastVisible")}</p> : null}
    </div>
  );
}

/** The one line a hidden or unused side shrinks to at the bottom of Home — never an empty shelf. */
export function HomeSideLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border border-dashed border-[var(--line)] px-4 text-left text-sm text-[var(--muted)] transition hover:border-[var(--main-line)] hover:text-[var(--ink)]"
    >
      <span>{label}</span>
      <span aria-hidden="true">→</span>
    </button>
  );
}
