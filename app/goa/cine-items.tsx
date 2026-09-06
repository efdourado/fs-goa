"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { apiRequest } from "./api";
import type { CatalogItem, ChallengeItemInput, Id, Member } from "./types";
import { Button, cx, inputClass, labelClass, StatusMessage } from "./ui";
import { formatRuntime } from "./utils";

export interface CineRow {
  key: string;
  title: string;
  catalogItemId?: Id;
  recommendedByUserId: string;
  author: string;
  year: string;
  pages: string;
  /** Films/series only, in minutes. */
  runtimeMinutes: string;
  mainGenre: string;
}

export function newCineRow(title = "", extra: Partial<CineRow> = {}): CineRow {
  return {
    key: crypto.randomUUID(),
    title,
    recommendedByUserId: "",
    author: "",
    year: "",
    pages: "",
    runtimeMinutes: "",
    mainGenre: "",
    ...extra,
  };
}

/** Reads any of a small set of aliases off a pasted JSON object, first match wins. */
function pick(raw: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (raw[key] !== undefined && raw[key] !== null) return raw[key];
  return undefined;
}

function asFieldString(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/** Keys the wizard understands; anything else is reported back, not silently dropped. */
const KNOWN_PASTE_KEYS = new Set([
  "title",
  "mainGenre", "main_genre", "genre", "genres",
  "author", "authors", "by",
  "year",
  "pageCount", "pages",
  "runtimeMinutes", "runtime_minutes", "duration", "durationMinutes",
].map((key) => key.toLowerCase()));

export interface JsonPasteSummary {
  /** Entries in the pasted array, valid or not. */
  total: number;
  added: number;
  /** Not an object, or without a usable `title`. */
  invalid: number;
  /** Title already among the rows, or repeated inside the paste itself. */
  duplicates: number;
  unknownKeys: string[];
}

/**
 * Parses a pasted JSON array of `{title, year, pageCount, mainGenre}` objects
 * into rows — the "already have the list ready" fast path, as an alternative to
 * typing titles one by one. Throws a translation key when the text isn't a JSON
 * array at all; anything discarded per entry comes back in the summary, so the
 * wizard can account for it the way the post-creation importer does.
 */
export function parseJsonItemsPaste(
  text: string,
  existingTitles: Set<string>,
): { rows: CineRow[]; summary: JsonPasteSummary } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("jsonInvalid");
  }
  if (!Array.isArray(parsed)) throw new Error("jsonMustBeArray");
  if (!parsed.length) throw new Error("jsonNoItems");
  const known = new Set(existingTitles);
  const rows: CineRow[] = [];
  const unknownKeys = new Set<string>();
  let invalid = 0;
  let duplicates = 0;
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      invalid += 1;
      continue;
    }
    const raw = entry as Record<string, unknown>;
    for (const key of Object.keys(raw)) {
      if (!KNOWN_PASTE_KEYS.has(key.toLowerCase())) unknownKeys.add(key);
    }
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    if (!title) {
      invalid += 1;
      continue;
    }
    if (known.has(title.toLowerCase())) {
      duplicates += 1;
      continue;
    }
    known.add(title.toLowerCase());
    const genreValue = pick(raw, "mainGenre", "main_genre", "genre", "genres");
    const mainGenre = Array.isArray(genreValue)
      ? genreValue.find((value): value is string => typeof value === "string") ?? ""
      : typeof genreValue === "string" ? genreValue : "";
    const authorValue = pick(raw, "author", "authors", "by");
    const author = Array.isArray(authorValue)
      ? authorValue.filter((value): value is string => typeof value === "string").join(", ")
      : asFieldString(authorValue);
    rows.push(newCineRow(title, {
      author,
      year: asFieldString(pick(raw, "year")),
      pages: asFieldString(pick(raw, "pageCount", "pages")),
      runtimeMinutes: asFieldString(pick(raw, "runtimeMinutes", "runtime_minutes", "duration", "durationMinutes")),
      mainGenre,
    }));
  }
  return {
    rows,
    summary: {
      total: parsed.length,
      added: rows.length,
      invalid,
      duplicates,
      unknownKeys: [...unknownKeys].sort(),
    },
  };
}

export function cineRowsToInput(rows: CineRow[]): ChallengeItemInput[] {
  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.title.trim())
    .map(({ row, index }) => {
      const year = Number(row.year);
      const pages = Number(row.pages);
      const runtimeMinutes = Number(row.runtimeMinutes);
      return {
        title: row.title.trim(),
        position: index,
        ...(row.catalogItemId ? { catalogItemId: row.catalogItemId } : {}),
        ...(row.recommendedByUserId ? { recommendedByUserId: row.recommendedByUserId } : {}),
        ...(row.author.trim() ? { author: row.author.trim() } : {}),
        ...(Number.isInteger(year) && year > 1800 ? { year } : {}),
        ...(Number.isInteger(pages) && pages > 0 ? { pageCount: pages } : {}),
        ...(Number.isInteger(runtimeMinutes) && runtimeMinutes > 0 ? { runtimeMinutes } : {}),
        ...(row.mainGenre.trim() ? { mainGenre: row.mainGenre.trim() } : {}),
      };
    });
}

export function CineItemsEditor({
  value,
  onChange,
  members,
  catalogPath,
  kind = "film",
}: {
  value: CineRow[];
  onChange: (rows: CineRow[]) => void;
  members: Member[];
  /** Group and personal catalogs have different public routes. */
  catalogPath: string;
  /** Filters the "from catalog" picker and shows attributes relevant to the medium. */
  kind?: "film" | "book";
}) {
  const t = useTranslations("cineItems");
  const [paste, setPaste] = useState("");
  const [pasteMode, setPasteMode] = useState<"simple" | "json">("simple");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasteSummary, setPasteSummary] = useState<JsonPasteSummary | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!showCatalog || catalog) return;
    const controller = new AbortController();
    apiRequest<{ items: CatalogItem[] }>(catalogPath, { signal: controller.signal })
      .then((response) => setCatalog(response.items.filter((item) => item.kind === kind)))
      .catch(() => setCatalog([]));
    return () => controller.abort();
  }, [showCatalog, catalog, catalogPath, kind]);

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
    setPasteSummary(null);
    if (pasteMode === "json") {
      const known = new Set(value.map((row) => row.title.trim().toLowerCase()));
      try {
        const { rows, summary } = parseJsonItemsPaste(paste, known);
        // Always report what came in — including entries dropped as invalid or
        // duplicated — so nothing disappears without the person being told.
        setPasteSummary(summary);
        if (rows.length) {
          onChange([...value, ...rows]);
          setPaste("");
        }
      } catch (cause) {
        setPasteError(t(cause instanceof Error ? cause.message : "jsonInvalid"));
      }
      return;
    }
    const titles = paste.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!titles.length) return;
    const known = new Set(value.map((row) => row.title.trim().toLowerCase()));
    const fresh = titles
      .filter((title) => {
        if (known.has(title.toLowerCase())) return false;
        known.add(title.toLowerCase());
        return true;
      })
      .map((title) => newCineRow(title));
    onChange([...value, ...fresh]);
    setPasteSummary({
      total: titles.length,
      added: fresh.length,
      invalid: 0,
      duplicates: titles.length - fresh.length,
      unknownKeys: [],
    });
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
                  {kind === "book" ? (
                    <label>
                      <span className="sr-only">{t("author")}</span>
                      <input className={cx(inputClass, row.title.trim() && !row.author.trim() ? "border-[var(--danger)]" : "")} value={row.author} maxLength={200} placeholder={t("authorPlaceholder")} onChange={(event) => update(row.key, { author: event.target.value })} />
                    </label>
                  ) : (
                    <label>
                      <span className="sr-only">{t("recommendedBy")}</span>
                      <select className={inputClass} value={row.recommendedByUserId} onChange={(event) => update(row.key, { recommendedByUserId: event.target.value })}>
                        <option value="">{t("recommendedByNone")}</option>
                        {members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}
                      </select>
                    </label>
                  )}
                  <div className="flex items-start gap-1">
                    <button type="button" className="min-h-11 rounded-lg px-2 text-xs text-[var(--muted)] hover:text-[var(--ink)]" aria-expanded={open} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next; })}>
                      {open ? t("hideDetails") : t("details")}
                    </button>
                    <button type="button" className="min-h-11 cursor-pointer rounded-lg px-2 text-xs text-[var(--danger)] hover:underline" onClick={() => remove(row.key)}>{t("remove")}</button>
                  </div>
                </div>
                {open ? (
                  <div className="mt-2 space-y-2">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <label><span className={labelClass}>{t(kind === "film" ? "latestYear" : "year")}</span><input className={inputClass} type="number" inputMode="numeric" min={1870} max={2200} value={row.year} onChange={(event) => update(row.key, { year: event.target.value })} /></label>
                      {kind === "book"
                        ? <label><span className={labelClass}>{t("pages")}</span><input className={inputClass} type="number" inputMode="numeric" min={1} max={100000} value={row.pages} onChange={(event) => update(row.key, { pages: event.target.value })} /></label>
                        : <label><span className={labelClass}>{t("runtimeMinutes")}</span><input className={inputClass} type="number" inputMode="numeric" min={1} max={2000} value={row.runtimeMinutes} placeholder={t("runtimeMinutesPlaceholder")} onChange={(event) => update(row.key, { runtimeMinutes: event.target.value })} /></label>}
                      <label><span className={labelClass}>{t("mainGenre")}</span><input className={inputClass} value={row.mainGenre} maxLength={80} placeholder={t("mainGenrePlaceholder")} onChange={(event) => update(row.key, { mainGenre: event.target.value })} /></label>
                    </div>
                    {kind === "book" && members.length ? (
                      <label className="block"><span className={labelClass}>{t("recommendedBy")}</span><select className={inputClass} value={row.recommendedByUserId} onChange={(event) => update(row.key, { recommendedByUserId: event.target.value })}><option value="">{t("recommendedByNone")}</option>{members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
                    ) : null}
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
              onClick={() => { setPasteMode(mode); setPasteError(null); setPasteSummary(null); }}
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
        {pasteSummary ? (
          <div className="mb-2 space-y-1">
            <StatusMessage
              error={pasteSummary.added ? null : t("pasteSummaryNone")}
              success={pasteSummary.added
                ? t("pasteSummary", {
                    total: pasteSummary.total,
                    added: pasteSummary.added,
                    invalid: pasteSummary.invalid,
                    duplicates: pasteSummary.duplicates,
                  })
                : null}
            />
            {pasteSummary.unknownKeys.length ? (
              <p className="text-[11px] leading-4 text-[var(--muted)]">
                {t("pasteUnknownKeys", { keys: pasteSummary.unknownKeys.join(", ") })}
              </p>
            ) : null}
          </div>
        ) : null}
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
                  onClick={() => onChange([...value, newCineRow(item.title, { catalogItemId: item.id, author: item.author ?? "", year: item.year ? String(item.year) : "", pages: item.pageCount ? String(item.pageCount) : "", runtimeMinutes: item.runtimeMinutes ? String(item.runtimeMinutes) : "", mainGenre: item.mainGenre ?? "" })])}
                  className={cx("flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--wash)] disabled:opacity-40", "")}
                >
                  <span>{item.title}{item.year ? ` (${item.year})` : ""}{item.author ? <span className="text-[var(--muted)]"> · {item.author}</span> : null}{item.mainGenre ? <span className="text-[var(--muted)]"> · {item.mainGenre}</span> : null}{formatRuntime(item.runtimeMinutes) ? <span className="text-[var(--muted)]"> · {formatRuntime(item.runtimeMinutes)}</span> : null}</span>
                  <span className="text-xs text-[var(--muted)]">{usedCatalogIds.has(item.id) ? t("alreadyAdded") : t("roundsCount", { count: item.roundCount ?? 0 })}</span>
                </button>
              ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
