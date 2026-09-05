"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { useGoaFormat } from "./format";
import type { ChallengeItemInput, ImportPreview } from "./types";
import { Button, cx, inputClass, StatusMessage } from "./ui";

const MAPPABLE = ["", "title", "year", "author", "pageCount", "runtimeMinutes", "mainGenre", "recommendedBy", "origin"] as const;

const PLACEHOLDER = `[
  { "title": "Aftersun", "year": 2022, "recommendedBy": "Ana" },
  { "title": "A Substância", "origin": "lista de um blog" }
]`;

export function ListImportPanel({
  onPreview,
  onCommit,
}: {
  onPreview: (body: { json: string; mapping?: Record<string, string> }) => Promise<ImportPreview>;
  onCommit: (items: ChallengeItemInput[]) => Promise<void>;
}) {
  const t = useTranslations("listImport");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [json, setJson] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function analyse() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const cleanMapping = Object.fromEntries(Object.entries(mapping).filter(([, value]) => value));
      const result = await onPreview({ json, ...(Object.keys(cleanMapping).length ? { mapping: cleanMapping } : {}) });
      setPreview(result);
      // Default: drop invalid rows and ones already in the challenge.
      setExcluded(new Set(result.rows.filter((row) => !row.valid || row.duplicateInChallenge).map((row) => row.index)));
    } catch (cause) {
      setPreview(null);
      setError(f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  function toggle(index: number) {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function confirm() {
    if (!preview) return;
    const rows = preview.rows.filter((row) => row.valid && !excluded.has(row.index));
    if (!rows.length) {
      setError(t("nothingToAdd"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const items: ChallengeItemInput[] = rows.map((row, position) => ({
        title: row.title,
        position,
        ...(row.existingCatalogItemId ? { catalogItemId: row.existingCatalogItemId } : {}),
        ...(row.mapped.author ? { author: row.mapped.author } : {}),
        ...(row.mapped.year ? { year: row.mapped.year } : {}),
        ...(row.mapped.pageCount ? { pageCount: row.mapped.pageCount } : {}),
        ...(row.mapped.runtimeMinutes ? { runtimeMinutes: row.mapped.runtimeMinutes } : {}),
        ...(row.mapped.mainGenre ? { mainGenre: row.mapped.mainGenre } : {}),
        ...(row.recommendation?.kind === "participant" ? { recommendedByUserId: row.recommendation.userId } : {}),
        ...(row.recommendation?.kind === "origin" ? { originNote: row.recommendation.text } : {}),
      }));
      await onCommit(items);
      setDone(t("added", { count: items.length }));
      setPreview(null);
      setJson("");
      setMapping({});
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  const includedCount = preview
    ? preview.rows.filter((row) => row.valid && !excluded.has(row.index)).length
    : 0;

  return (
    <div className="rounded-2xl border border-dashed border-[var(--main-line)] bg-[var(--main-soft)]/40 p-4">
      <p className="mb-1 text-sm font-light text-[var(--main-strong)]">{t("title")}</p>
      <p className="mb-3 text-xs leading-5 text-[var(--muted)]">{t("hint")}</p>
      <label className="block">
        <span className="sr-only">{t("jsonLabel")}</span>
        <textarea
          className={cx(inputClass, "font-mono text-xs")}
          rows={7}
          value={json}
          placeholder={PLACEHOLDER}
          onChange={(event) => setJson(event.target.value)}
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy || !json.trim()} onClick={() => void analyse()}>
          {busy ? t("analysing") : preview ? t("reanalyse") : t("analyse")}
        </Button>
      </div>
      <StatusMessage error={error} success={done} />

      {preview ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-[var(--muted)]">
            {t("summary", {
              total: preview.summary.total,
              importable: preview.summary.importable,
              invalid: preview.summary.invalid,
              dupChallenge: preview.summary.duplicatesInChallenge,
              dupCatalog: preview.summary.duplicatesInCatalog,
            })}
          </p>

          {preview.summary.unknownKeys.length ? (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3">
              <p className="mb-2 text-xs font-medium">{t("unknownKeysTitle")}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {preview.summary.unknownKeys.map((key) => (
                  <label className="flex items-center gap-2 text-xs" key={key}>
                    <code className="rounded bg-[var(--wash)] px-1.5 py-0.5">{key}</code>
                    <span aria-hidden>→</span>
                    <select
                      className="min-h-9 flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2"
                      value={mapping[key] ?? ""}
                      onChange={(event) => setMapping((current) => ({ ...current, [key]: event.target.value }))}
                    >
                      {MAPPABLE.map((field) => (
                        <option value={field} key={field || "ignore"}>{field ? t(`field.${field}`) : t("ignoreKey")}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-[var(--muted)]">{t("unknownKeysNote")}</p>
            </div>
          ) : null}

          <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--paper)]">
            {preview.rows.map((row) => {
              const included = row.valid && !excluded.has(row.index);
              const badges = [
                !row.valid ? { text: t("badgeInvalid"), tone: "danger" as const } : null,
                row.duplicateInChallenge ? { text: t("badgeInChallenge"), tone: "muted" as const } : null,
                row.existingCatalogItemId && !row.duplicateInChallenge ? { text: t("badgeInCatalogue"), tone: "muted" as const } : null,
                row.recommendation?.kind === "participant" ? { text: t("badgeRecommender", { name: row.recommendation.name }), tone: "ok" as const } : null,
                row.recommendation?.kind === "origin" ? { text: t("badgeOrigin", { text: row.recommendation.text }), tone: "ok" as const } : null,
              ].filter(Boolean) as Array<{ text: string; tone: "danger" | "muted" | "ok" }>;
              return (
                <li className="flex items-start gap-3 p-2.5 text-sm" key={row.index}>
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={included}
                    disabled={!row.valid}
                    aria-label={t("includeRow", { title: row.title || `#${row.index + 1}` })}
                    onChange={() => toggle(row.index)}
                  />
                  <div className="min-w-0 flex-1">
                    <strong className={cx("block", !row.valid && "text-[var(--muted)] line-through")}>
                      {row.title || t("noTitle")}
                      {row.mapped.year ? ` (${row.mapped.year})` : ""}
                    </strong>
                    {row.errors.length ? <span className="block text-xs text-[var(--danger)]">{row.errors.join(" · ")}</span> : null}
                    {badges.length ? (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {badges.map((badge, badgeIndex) => (
                          <span
                            key={badgeIndex}
                            className={cx(
                              "rounded-full px-2 py-0.5 text-[10px]",
                              badge.tone === "danger" && "bg-[var(--danger)]/15 text-[var(--danger)]",
                              badge.tone === "ok" && "bg-[var(--main-soft)] text-[var(--main-strong)]",
                              badge.tone === "muted" && "bg-[var(--wash)] text-[var(--muted)]",
                            )}
                          >
                            {badge.text}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    {row.unknownKeys.length ? (
                      <span className="mt-1 block text-[11px] text-[var(--muted)]">{t("rowUnknownKeys", { keys: row.unknownKeys.join(", ") })}</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={busy || !includedCount} onClick={() => void confirm()}>
              {busy ? tc("saving") : t("confirm", { count: includedCount })}
            </Button>
            <button type="button" className="text-sm text-[var(--muted)] underline hover:text-[var(--ink)]" onClick={() => { setPreview(null); setError(null); }}>
              {tc("cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
