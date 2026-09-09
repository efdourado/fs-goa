"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { API_PATHS, apiRequest } from "./api";
import type { Id } from "./types";

interface PreflightIssue { code: string; severity: "error" | "warning"; message: string }
export interface PreflightReport { ready: boolean; errors: PreflightIssue[]; warnings: PreflightIssue[] }

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
        <button type="button" className="text-xs font-light text-[var(--muted)] hover:text-[var(--ink)] hover:underline" onClick={load} disabled={loading}>
          {loading ? t("checking") : t("recheck")}
        </button>
      </div>
      {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
      {report ? (
        <div className="mt-4 space-y-4">
          {report.errors.length ? (
            <div className="rounded-2xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] p-4">
              <p className="text-sm font-medium text-[var(--danger)]">{t("fixFirst", { count: report.errors.length })}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {report.errors.map((issue, index) => <li key={`${issue.code}-${index}`}>· {label(issue)}</li>)}
              </ul>
            </div>
          ) : null}
          {report.warnings.length ? (
            <div className="rounded-2xl border border-[var(--warn-line)]/50 bg-[var(--warn-soft)] p-4">
              <p className="text-sm font-medium text-[var(--warn-strong)]">{t("worthReviewing", { count: report.warnings.length })}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {report.warnings.map((issue, index) => <li key={`${issue.code}-${index}`}>· {label(issue)}</li>)}
              </ul>
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
