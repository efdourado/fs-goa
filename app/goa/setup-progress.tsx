"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import type { PreflightReport } from "./preflight-panel";
import type { AdminTab, Id } from "./types";
import { Button, cx } from "./ui";

/** Which admin tab a readiness issue is fixed in. An unknown code still counts, it just points nowhere. */
const ISSUE_TAB: Record<string, AdminTab> = {
  no_participants: "overview",
  no_entry_type: "fields",
  primary_type_no_fields: "fields",
  choice_without_options: "fields",
  recipe_essential_field_missing: "fields",
  many_required_fields: "fields",
  no_comment_source: "fields",
  expectation_visible_early: "fields",
  no_items: "items",
  no_way_to_register: "items",
  no_checkpoints: "checkpoints",
  checkpoint_outside_period: "checkpoints",
  many_items_for_period: "checkpoints",
  metric_field_archived: "metrics",
  metric_needs_field: "metrics",
  metric_field_not_numeric: "metrics",
  no_metrics: "metrics",
  ranking_min_sample_unreachable: "metrics",
  metric_on_optional_field: "metrics",
};

/** The tabs that have to be in order before a challenge can start, in the order to work through them. */
export const SETUP_STEPS: readonly AdminTab[] = ["overview", "fields", "items", "checkpoints"];

export interface SetupState {
  /** Blocking problems per tab. */
  errors: Partial<Record<AdminTab, number>>;
  /** Every blocking problem — the gate that keeps the challenge from starting. */
  errorCount: number;
  /** What there is to do: one per tab with a problem (two gaps in Items are one job), plus any that point nowhere. */
  todoCount: number;
  /** The first tab, in the given order, that still has a blocking problem. */
  firstTodo: AdminTab | null;
  /** One message per thing to do — the first problem of each tab. */
  reasons: PreflightReport["errors"];
}

/** Reads a readiness report as progress: what is left to fix, and where. */
export function setupState(report: PreflightReport, order: readonly AdminTab[]): SetupState {
  const errors: Partial<Record<AdminTab, number>> = {};
  const reasons: PreflightReport["errors"] = [];
  let elsewhere = 0;
  for (const issue of report.errors) {
    const tab = ISSUE_TAB[issue.code];
    if (!tab) {
      elsewhere += 1;
      reasons.push(issue);
      continue;
    }
    if (!errors[tab]) reasons.push(issue);
    errors[tab] = (errors[tab] ?? 0) + 1;
  }
  return {
    errors,
    errorCount: report.errors.length,
    todoCount: Object.keys(errors).length + elsewhere,
    firstTodo: order.find((tab) => (errors[tab] ?? 0) > 0) ?? null,
    reasons,
  };
}

/** The readiness report of a draft, fetched again whenever `version` changes (the challenge was edited). */
export function useChallengePreflight(challengeId: Id, enabled: boolean, version: unknown): PreflightReport | null {
  const [report, setReport] = useState<PreflightReport | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    apiRequest<PreflightReport>(API_PATHS.preflight(challengeId), { signal: controller.signal })
      .then(setReport)
      .catch(() => undefined);
    return () => controller.abort();
  }, [challengeId, enabled, version]);
  return enabled ? report : null;
}

/** A step's mark on its tab: a check once it is in order, its number while something is still missing. */
export function StepMarker({ number, todo }: { number: number; todo: boolean }) {
  const t = useTranslations("adminChallenge.setup");
  return (
    <span
      className={cx(
        "grid h-[18px] w-[18px] flex-none place-items-center rounded-full border text-[10px] font-semibold leading-none",
        todo ? "border-[var(--warn-line)] bg-[var(--warn-soft)] text-[var(--warn-strong)]" : "border-[var(--ok-line)] bg-[var(--ok-soft)] text-[var(--ok)]",
      )}
    >
      {todo ? number : (
        <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      )}
      <span className="sr-only">{todo ? t("stepTodo") : t("stepDone")}</span>
    </span>
  );
}

/**
 * Above a draft's tabs: how far along the setup is, what is still missing, and one button to the next
 * thing to do. Once nothing blocks, it says the challenge is ready to start.
 */
export function SetupSummary({ state, activeTab, onGo }: {
  state: SetupState;
  activeTab: AdminTab;
  onGo: (tab: AdminTab) => void;
}) {
  const t = useTranslations("adminChallenge");
  const tCodes = useTranslations("preflight.codes");
  if (!state.errorCount) {
    return (
      <p className="mb-8 flex items-start gap-2 rounded-xl border border-[var(--ok-line)] bg-[var(--ok-soft)] px-4 py-3 text-sm font-medium text-[var(--ok)]">
        <StepMarker number={0} todo={false} />
        <span>{t("setup.ready")}</span>
      </p>
    );
  }
  const reasons = state.reasons.slice(0, 4).map((issue) => (tCodes.has(issue.code) ? tCodes(issue.code) : issue.message));
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-x-6 gap-y-3 rounded-xl border border-[var(--warn-line)] bg-[var(--warn-soft)] px-4 py-3 text-[var(--warn-strong)]">
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{t("setup.todo", { count: state.todoCount })}</p>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs leading-5">
          {reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      </div>
      {state.firstTodo && state.firstTodo !== activeTab ? (
        <Button className="min-h-11 flex-none px-5" onClick={() => onGo(state.firstTodo as AdminTab)}>{t("setup.go", { tab: t(`tabs.${state.firstTodo}`) })}</Button>
      ) : null}
    </div>
  );
}
