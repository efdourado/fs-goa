"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import type { CatalogItem, ChallengeItemInput, Id, Member } from "./types";
import { Button, cx, inputClass, labelClass, StatusMessage } from "./ui";

export interface CineRow {
  key: string;
  title: string;
  catalogItemId?: Id;
  recommendedByUserId: string;
  year: string;
  runtime: string;
  pages: string;
  genres: string;
}

export function newCineRow(title = "", extra: Partial<CineRow> = {}): CineRow {
  return { key: crypto.randomUUID(), title, recommendedByUserId: "", year: "", runtime: "", pages: "", genres: "", ...extra };
}

/** Reads any of a small set of aliases off a pasted JSON object, first match wins. */
function pick(raw: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (raw[key] !== undefined && raw[key] !== null) return raw[key];
  return undefined;
}

function asFieldString(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/**
 * Parses a pasted JSON array of `{title, year, runtimeMinutes|pageCount, genres}`
 * objects into rows — the "already have the list ready" fast path, as an
 * alternative to typing titles one by one. Throws a translation key on failure.
 */
export function parseJsonItemsPaste(text: string, existingTitles: Set<string>): CineRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("jsonInvalid");
  }
  if (!Array.isArray(parsed)) throw new Error("jsonMustBeArray");
  const known = new Set(existingTitles);
  const rows: CineRow[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    if (!title || known.has(title.toLowerCase())) continue;
    known.add(title.toLowerCase());
    const genresValue = pick(raw, "genres", "genre");
    const genres = Array.isArray(genresValue)
      ? genresValue.filter((value): value is string => typeof value === "string").join(", ")
      : typeof genresValue === "string" ? genresValue : "";
    rows.push(newCineRow(title, {
      year: asFieldString(pick(raw, "year")),
      runtime: asFieldString(pick(raw, "runtimeMinutes", "runtime", "duration", "durationMinutes")),
      pages: asFieldString(pick(raw, "pageCount", "pages")),
      genres,
    }));
  }
  if (!rows.length) throw new Error("jsonNoItems");
  return rows;
}

export function cineRowsToInput(rows: CineRow[]): ChallengeItemInput[] {
  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.title.trim())
    .map(({ row, index }) => {
      const year = Number(row.year);
      const runtime = Number(row.runtime);
      const pages = Number(row.pages);
      const genres = row.genres.split(",").map((genre) => genre.trim()).filter(Boolean);
      return {
        title: row.title.trim(),
        position: index,
        ...(row.catalogItemId ? { catalogItemId: row.catalogItemId } : {}),
        ...(row.recommendedByUserId ? { recommendedByUserId: row.recommendedByUserId } : {}),
        ...(Number.isInteger(year) && year > 1800 ? { year } : {}),
        ...(Number.isInteger(runtime) && runtime > 0 ? { runtimeMinutes: runtime } : {}),
        ...(Number.isInteger(pages) && pages > 0 ? { pageCount: pages } : {}),
        ...(genres.length ? { genres } : {}),
      };
    });
}

export function CineItemsEditor({
  value,
  onChange,
  members,
  groupId,
  kind = "film",
}: {
  value: CineRow[];
  onChange: (rows: CineRow[]) => void;
  members: Member[];
  groupId: Id;
  /** Filters the "from catalog" picker and swaps the runtime field for pages. */
  kind?: "film" | "book";
}) {
  const t = useTranslations("cineItems");
  const [paste, setPaste] = useState("");
  const [pasteMode, setPasteMode] = useState<"simple" | "json">("simple");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!showCatalog || catalog) return;
    const controller = new AbortController();
    apiRequest<{ items: CatalogItem[] }>(API_PATHS.groupCatalog(groupId), { signal: controller.signal })
      .then((response) => setCatalog(response.items.filter((item) => item.kind === kind)))
      .catch(() => setCatalog([]));
    return () => controller.abort();
  }, [showCatalog, catalog, groupId, kind]);

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
    setPasteError(null);
    if (pasteMode === "json") {
      const known = new Set(value.map((row) => row.title.trim().toLowerCase()));
      try {
        const rows = parseJsonItemsPaste(paste, known);
        onChange([...value, ...rows]);
        setPaste("");
      } catch (cause) {
        setPasteError(t(cause instanceof Error ? cause.message : "jsonInvalid"));
      }
      return;
    }
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
                    <button type="button" className="min-h-11 cursor-pointer rounded-lg px-2 text-xs text-[var(--danger)] hover:underline" onClick={() => remove(row.key)}>{t("remove")}</button>
                  </div>
                </div>
                {open ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-[110px_110px_1fr]">
                    <label><span className={labelClass}>{t("year")}</span><input className={inputClass} type="number" inputMode="numeric" min={1870} max={2200} value={row.year} onChange={(event) => update(row.key, { year: event.target.value })} /></label>
                    {kind === "book"
                      ? <label><span className={labelClass}>{t("pages")}</span><input className={inputClass} type="number" inputMode="numeric" min={1} max={100000} value={row.pages} onChange={(event) => update(row.key, { pages: event.target.value })} /></label>
                      : <label><span className={labelClass}>{t("runtime")}</span><input className={inputClass} type="number" inputMode="numeric" min={1} max={100000} value={row.runtime} onChange={(event) => update(row.key, { runtime: event.target.value })} /></label>}
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
        <div className="mb-2 flex gap-1 rounded-full bg-[var(--paper)] p-1 text-xs" role="tablist" aria-label={t("pasteModeAria")}>
          {(["simple", "json"] as const).map((mode) => (
            <button
              type="button"
              key={mode}
              role="tab"
              aria-selected={pasteMode === mode}
              className={cx("min-h-9 flex-1 rounded-full px-3 font-light", pasteMode === mode ? "bg-[var(--main-soft)] text-[var(--main-strong)]" : "text-[var(--muted)] hover:text-[var(--ink)]")}
              onClick={() => { setPasteMode(mode); setPasteError(null); }}
            >
              {mode === "simple" ? t("pasteModeSimple") : t("pasteModeJson")}
            </button>
          ))}
        </div>
        <label className="block"><span className={labelClass}>{pasteMode === "json" ? t("pasteJsonLabel") : t("pasteLabel")}</span>
          <textarea className={cx(inputClass, pasteMode === "json" ? "font-mono text-xs" : "")} rows={pasteMode === "json" ? 8 : 4} value={paste} onChange={(event) => setPaste(event.target.value)} placeholder={pasteMode === "json" ? t(kind === "book" ? "pasteJsonPlaceholderBook" : "pasteJsonPlaceholderFilm") : t("pastePlaceholder")} />
        </label>
        {pasteMode === "json" ? <p className="mb-2 text-xs leading-5 text-[var(--muted)]">{t("pasteJsonHint")}</p> : null}
        <StatusMessage error={pasteError} />
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
                  onClick={() => onChange([...value, newCineRow(item.title, { catalogItemId: item.id, year: item.year ? String(item.year) : "", runtime: item.runtimeMinutes ? String(item.runtimeMinutes) : "", pages: item.pageCount ? String(item.pageCount) : "", genres: item.genres.join(", ") })])}
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
