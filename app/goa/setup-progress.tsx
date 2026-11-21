"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import type { PreflightIssue, PreflightReport } from "../../lib/goa/challenges/preflight";
import type { AdminTab, ChallengeDetail } from "./types";

/** Which admin tab a blocking issue can be fixed in. */
const ISSUE_TAB: Partial<Record<string, AdminTab>> = {
  no_participants: "overview",
  no_entry_type: "fields",
  primary_type_no_fields: "fields",
  choice_without_options: "fields",
  recipe_essential_field_missing: "fields",
  // Item management lives with stages.
  no_items: "checkpoints",
  no_way_to_register: "checkpoints",
  no_checkpoints: "checkpoints",
  checkpoint_outside_period: "checkpoints",
  metric_field_archived: "results",
  metric_needs_field: "results",
  metric_field_not_numeric: "results",
};

/** The tabs that have to be in order before a challenge can start, in the order to work through them. */
export const SETUP_STEPS: readonly AdminTab[] = ["overview", "fields", "checkpoints", "results"];

export function setupBlockersByTab(report: PreflightReport, visibleTabs: readonly AdminTab[]): Partial<Record<AdminTab, PreflightIssue[]>> {
  const blockers: Partial<Record<AdminTab, PreflightIssue[]>> = {};
  for (const issue of report.errors) {
    const tab = ISSUE_TAB[issue.code];
    const visibleTab = tab && visibleTabs.includes(tab) ? tab : "overview";
    (blockers[visibleTab] ??= []).push(issue);
  }
  return blockers;
}

/** Refresh the blocking issues whenever the draft is reloaded after an edit. */
export function useChallengePreflight(challenge: ChallengeDetail) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ challenge: ChallengeDetail; attempt: number; report: PreflightReport | null } | null>(null);
  useEffect(() => {
    if (challenge.status !== "draft") return;
    const controller = new AbortController();
    apiRequest<PreflightReport>(API_PATHS.preflight(challenge.id), { signal: controller.signal })
      .then((report) => {
        if (!controller.signal.aborted) setResult({ challenge, attempt, report });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ challenge, attempt, report: null });
      });
    return () => controller.abort();
  }, [challenge, attempt]);
  const current = result?.challenge === challenge && result.attempt === attempt ? result : null;
  return { report: current?.report ?? null, failed: current?.report === null, retry: () => setAttempt((value) => value + 1) };
}

/** On a tab: how many things are left to fix there, the same count as the list on the tab ("1 thing left…"). */
export function SetupBlockerMarker({ count }: { count: number }) {
  const t = useTranslations("adminChallenge.setup");
  return (
    <span className="grid h-[18px] w-[18px] flex-none place-items-center rounded-full border border-[var(--warn-line)] bg-[var(--warn-soft)] text-[10px] font-semibold leading-none text-[var(--warn-strong)]">
      {count}
      <span className="sr-only">{t("stepTodo")}</span>
    </span>
  );
}

export function SetupBlockerList({ issues }: { issues?: PreflightIssue[] }) {
  const t = useTranslations("adminChallenge.setup");
  const tCodes = useTranslations("preflight.codes");
  if (!issues?.length) return null;

  return (
    <div className="rounded-xl border border-[var(--warn-line)] bg-[var(--warn-soft)] px-4 py-3 text-sm text-[var(--warn-strong)]">
      <p className="font-medium">{t("todo", { count: issues.length })}</p>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs leading-5">
        {issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{tCodes.has(issue.code) ? tCodes(issue.code) : issue.message}</li>)}
      </ul>
    </div>
  );
}
