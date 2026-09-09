"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { API_PATHS, apiRequest } from "./api";
import type { Id } from "./types";
import { cx } from "./ui";

interface PreflightIssue { code: string; severity: "error" | "warning"; message: string }
export interface PreflightReport { ready: boolean; errors: PreflightIssue[]; warnings: PreflightIssue[] }

/** Left-aligned status marker for one issue: circle-minus for a blocker, plain circle for a note. */
function IssueList({ issues, kind, label }: { issues: PreflightIssue[]; kind: "error" | "warning"; label: (issue: PreflightIssue) => string }) {
  return (
    <ul className="mt-3 space-y-2 text-sm">
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`} className="flex gap-2">
          <svg viewBox="0 0 24 24" className={cx("mt-0.5 size-4 flex-none", kind === "error" ? "text-[var(--danger)]" : "text-[var(--warn-strong)]")} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            {kind === "error" ? <path d="M8.5 12h7" strokeLinecap="round" /> : null}
          </svg>
          <span>{label(issue)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The readiness check that gates activation — errors block, warnings only advise. */
export function PreflightPanel({ challengeId, onReady }: { challengeId: Id; onReady: (ready: boolean) => void }) {
  const t = useTranslations("preflight");
  const tCodes = useTranslations("preflight.codes");
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    apiRequest<PreflightReport>(API_PATHS.preflight(challengeId), { signal: controller.signal })
      .then((data) => { setReport(data); onReady(data.ready); })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : t("loadError"));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [challengeId, onReady, t]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => load(), [load]);

  const label = (issue: PreflightIssue) => (tCodes.has(issue.code) ? tCodes(issue.code) : issue.message);

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-medium tracking-tight">{t("title")}</h3>
        <button type="button" className="cursor-pointer text-xs font-light text-[var(--muted)] hover:text-[var(--ink)] hover:underline disabled:cursor-default disabled:opacity-60" onClick={load} disabled={loading}>
          {loading ? t("checking") : t("recheck")}
        </button>
      </div>
      {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
      {report ? (
        <div className="mt-4 space-y-4">
          {report.errors.length ? (
            <div className="rounded-2xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] p-4">
              <p className="text-sm font-medium text-[var(--danger)]">{t("fixFirst", { count: report.errors.length })}</p>
              <IssueList issues={report.errors} kind="error" label={label} />
            </div>
          ) : null}
          {report.warnings.length ? (
            <div className="rounded-2xl border border-[var(--warn-line)]/50 bg-[var(--warn-soft)] p-4">
              <p className="text-sm font-medium text-[var(--warn-strong)]">{t("worthReviewing", { count: report.warnings.length })}</p>
              <IssueList issues={report.warnings} kind="warning" label={label} />
            </div>
          ) : null}
          {report.ready && !report.warnings.length ? (
            <p className="rounded-2xl border border-[var(--ok-line)]/40 bg-[var(--ok-soft)] p-4 text-sm font-medium text-[var(--ok-strong)]">{t("allReady")}</p>
          ) : null}
          {report.ready && report.warnings.length ? (
            <p className="text-xs text-[var(--muted)]">{t("readyWithWarnings")}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
