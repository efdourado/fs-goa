"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import type { CatalogItem, ChallengeItemInput, Id, Member } from "./types";
import { Button, cx, inputClass, labelClass } from "./ui";

export interface CineRow {
  key: string;
  title: string;
  catalogItemId?: Id;
  recommendedByUserId: string;
  year: string;
  runtime: string;
  genres: string;
}

export function newCineRow(title = "", extra: Partial<CineRow> = {}): CineRow {
  return { key: crypto.randomUUID(), title, recommendedByUserId: "", year: "", runtime: "", genres: "", ...extra };
}

export function cineRowsToInput(rows: CineRow[]): ChallengeItemInput[] {
  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.title.trim())
    .map(({ row, index }) => {
      const year = Number(row.year);
      const runtime = Number(row.runtime);
      const genres = row.genres.split(",").map((genre) => genre.trim()).filter(Boolean);
      return {
        title: row.title.trim(),
        position: index,
        ...(row.catalogItemId ? { catalogItemId: row.catalogItemId } : {}),
        ...(row.recommendedByUserId ? { recommendedByUserId: row.recommendedByUserId } : {}),
        ...(Number.isInteger(year) && year > 1800 ? { year } : {}),
        ...(Number.isInteger(runtime) && runtime > 0 ? { runtimeMinutes: runtime } : {}),
        ...(genres.length ? { genres } : {}),
      };
    });
}

export function CineItemsEditor({
  value,
  onChange,
  members,
  groupId,
}: {
  value: CineRow[];
  onChange: (rows: CineRow[]) => void;
  members: Member[];
  groupId: Id;
}) {
  const t = useTranslations("cineItems");
  const [paste, setPaste] = useState("");
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!showCatalog || catalog) return;
    const controller = new AbortController();
    apiRequest<{ items: CatalogItem[] }>(API_PATHS.groupCatalog(groupId), { signal: controller.signal })
      .then((response) => setCatalog(response.items.filter((item) => item.kind === "film")))
      .catch(() => setCatalog([]));
    return () => controller.abort();
  }, [showCatalog, catalog, groupId]);

  const usedCatalogIds = useMemo(
    () => new Set(value.map((row) => row.catalogItemId).filter(Boolean)),
    [value],
  );

  function update(key: string, patch: Partial<CineRow>) {
    onChange(value.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  function remove(key: string) {
    onChange(value.filter((row) => row.key !== key));
  }
  function appendPaste() {
    const titles = paste.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!titles.length) return;
    const known = new Set(value.map((row) => row.title.trim().toLowerCase()));
    const fresh = titles.filter((title) => !known.has(title.toLowerCase())).map((title) => newCineRow(title));
    onChange([...value, ...fresh]);
    setPaste("");
  }

  return (
    <div className="space-y-4">
      {value.length ? (
        <ol className="space-y-2">
          {value.map((row, index) => {
            const open = expanded.has(row.key);
            return (
              <li className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-3" key={row.key}>
                <div className="grid gap-2 sm:grid-cols-[1.6fr_1fr_auto]">
                  <label>
                    <span className="sr-only">{t("titleLabel")}</span>
                    <input className={inputClass} value={row.title} maxLength={200} placeholder={t("titlePlaceholder")} onChange={(event) => update(row.key, { title: event.target.value, catalogItemId: undefined })} />
                  </label>
                  <label>
                    <span className="sr-only">{t("recommendedBy")}</span>
                    <select className={inputClass} value={row.recommendedByUserId} onChange={(event) => update(row.key, { recommendedByUserId: event.target.value })}>
                      <option value="">{t("recommendedByNone")}</option>
                      {members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}
                    </select>
                  </label>
                  <div className="flex items-start gap-1">
                    <button type="button" className="min-h-11 rounded-lg px-2 text-xs text-[var(--muted)] hover:text-[var(--ink)]" aria-expanded={open} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next; })}>
                      {open ? t("hideDetails") : t("details")}
                    </button>
                    <button type="button" className="min-h-11 rounded-lg px-2 text-xs text-[var(--danger)] hover:underline" onClick={() => remove(row.key)}>{t("remove")}</button>
                  </div>
                </div>
                {open ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-[110px_110px_1fr]">
                    <label><span className={labelClass}>{t("year")}</span><input className={inputClass} type="number" inputMode="numeric" min={1870} max={2200} value={row.year} onChange={(event) => update(row.key, { year: event.target.value })} /></label>
                    <label><span className={labelClass}>{t("runtime")}</span><input className={inputClass} type="number" inputMode="numeric" min={1} max={100000} value={row.runtime} onChange={(event) => update(row.key, { runtime: event.target.value })} /></label>
                    <label><span className={labelClass}>{t("genres")}</span><input className={inputClass} value={row.genres} placeholder={t("genresPlaceholder")} onChange={(event) => update(row.key, { genres: event.target.value })} /></label>
                  </div>
                ) : null}
                <span className="sr-only">{index + 1}</span>
              </li>
            );
          })}
        </ol>
      ) : null}

      <div className="rounded-2xl border border-dashed border-[var(--main-line)] bg-[var(--main-soft)]/50 p-3">
        <label className="block"><span className={labelClass}>{t("pasteLabel")}</span>
          <textarea className={inputClass} rows={4} value={paste} onChange={(event) => setPaste(event.target.value)} placeholder={t("pastePlaceholder")} />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={appendPaste} disabled={!paste.trim()}>{t("addPasted")}</Button>
          <Button variant="ghost" onClick={() => setShowCatalog((open) => !open)}>{showCatalog ? t("hideCatalog") : t("fromCatalog")}</Button>
        </div>
        {showCatalog ? (
          <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--paper)] p-2">
            {catalog === null ? <p className="p-2 text-xs text-[var(--muted)]">{t("loadingCatalog")}</p>
              : catalog.length === 0 ? <p className="p-2 text-xs text-[var(--muted)]">{t("emptyCatalog")}</p>
              : catalog.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={usedCatalogIds.has(item.id)}
                  onClick={() => onChange([...value, newCineRow(item.title, { catalogItemId: item.id, year: item.year ? String(item.year) : "", runtime: item.runtimeMinutes ? String(item.runtimeMinutes) : "", genres: item.genres.join(", ") })])}
                  className={cx("flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--wash)] disabled:opacity-40", "")}
                >
                  <span>{item.title}{item.year ? <span className="text-[var(--muted)]"> · {item.year}</span> : null}{item.genres.length ? <span className="text-[var(--muted)]"> · {item.genres.join(", ")}</span> : null}</span>
                  <span className="text-xs text-[var(--muted)]">{usedCatalogIds.has(item.id) ? t("alreadyAdded") : t("roundsCount", { count: item.roundCount ?? 0 })}</span>
                </button>
              ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
