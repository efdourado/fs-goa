"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { API_PATHS, apiRequest } from "./api";
import type { Id } from "./types";
import { cx } from "./ui";

interface PreflightIssue { code: string; severity: "error" | "warning"; message: string }
export interface PreflightReport { ready: boolean; errors: PreflightIssue[]; warnings: PreflightIssue[] }

type MarkerKind = "error" | "warning" | "ok";

/** Circle-minus for a blocker, plain circle for a note, circle-check when ready. One per group, y-centred. */
function Marker({ kind }: { kind: MarkerKind }) {
  const tone = kind === "error" ? "text-[var(--danger)]" : kind === "warning" ? "text-[var(--warn-strong)]" : "text-[var(--ok-strong)]";
  return (
    <svg viewBox="0 0 24 24" className={cx("size-5 flex-none", tone)} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      {kind === "error" ? <path d="M8.5 12h7" strokeLinecap="round" /> : null}
      {kind === "ok" ? <path d="M8.5 12.3l2.4 2.4 4.6-5" strokeLinecap="round" strokeLinejoin="round" /> : null}
    </svg>
  );
}

/** One preflight group — a single y-centred marker beside the count headline and its issues. */
function PreflightGroup({ heading, issues, kind, label }: {
  heading: string;
  issues: PreflightIssue[];
  kind: "error" | "warning";
  label: (issue: PreflightIssue) => string;
}) {
  return (
    <div className={cx("flex items-center gap-3 rounded-2xl border p-4", kind === "error" ? "border-[var(--danger)]/40 bg-[var(--danger-soft)]" : "border-[var(--warn-line)]/50 bg-[var(--warn-soft)]")}>
      <Marker kind={kind} />
      <div className="min-w-0">
        <p className={cx("text-sm font-medium", kind === "error" ? "text-[var(--danger)]" : "text-[var(--warn-strong)]")}>{heading}</p>
        <ul className="mt-1 space-y-1 text-sm">
          {issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{label(issue)}</li>)}
        </ul>
      </div>
    </div>
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
            <PreflightGroup heading={t("fixFirst", { count: report.errors.length })} issues={report.errors} kind="error" label={label} />
          ) : null}
          {report.warnings.length ? (
            <PreflightGroup heading={t("worthReviewing", { count: report.warnings.length })} issues={report.warnings} kind="warning" label={label} />
          ) : null}
          {report.ready && !report.warnings.length ? (
            <p className="flex items-center gap-3 rounded-2xl border border-[var(--ok-line)]/40 bg-[var(--ok-soft)] p-4 text-sm font-medium text-[var(--ok-strong)]"><Marker kind="ok" /><span>{t("allReady")}</span></p>
          ) : null}
          {report.ready && report.warnings.length ? (
            <p className="text-xs text-[var(--muted)]">{t("readyWithWarnings")}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
