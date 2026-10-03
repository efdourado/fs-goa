"use client";

import { useTranslations } from "next-intl";
import { useFormatter } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import { Dialog, FormDialog } from "./dialog";
import { canOrganise, OrganiseDialog, organiseFromRows } from "./organize-panel";
import { type CatalogScope } from "./libraries";
import { bodyFromValues, editableProperties, PropertyInputs, type PropertyValues, propertiesHaveProblem, useLibrariesProperties } from "./property-inputs";
import {
  NO_RECOMMENDER,
  recommenderBody,
  RecommenderPicker,
  type RecommenderSource,
  type RecommenderValue,
  useRecommenderSource,
} from "./recommender-picker";
import { decodeEventForm, encodeEventForm, eventBodyOf, eventFormOf } from "./schedule";
import type { CatalogItem, ChallengeItemInput, ChallengeLibraryRef, Id, LibraryProperty, Member } from "./types";
import { Button, cx, inputClass, labelClass, StatusMessage } from "./ui";
import { formatRuntime } from "./utils";

export interface CineRow {
  key: string;
  title: string;
  catalogItemId?: Id;
  /** The library the item belongs to (`libraryId` is null for a built-in that has no row yet). */
  libraryKind: string;
  libraryId: Id | null;
  /** A member, a saved outside name or a note — one at most. */
  recommender: RecommenderValue;
  author: string;
  year: string;
  pages: string;
  /** Films/series only, in minutes. */
  runtimeMinutes: string;
  mainGenre: string;
  /** The item's own date and time (a match's kickoff), as the event inputs hold it — blank when it has none. */
  scheduled: string;
  /** What was typed into a custom library's own properties, by `LibraryProperty.key`. */
  extra: PropertyValues;
  /** The same values as the request wants them, by the property's storage key — kept in step with `extra` by the editor. */
  attributes: Record<string, string | number | boolean>;
}

function newCineRow(title = "", extra: Partial<CineRow> = {}): CineRow {
  return {
    key: crypto.randomUUID(),
    title,
    libraryKind: "",
    libraryId: null,
    recommender: NO_RECOMMENDER,
    author: "",
    year: "",
    pages: "",
    runtimeMinutes: "",
    mainGenre: "",
    scheduled: "",
    extra: {},
    attributes: {},
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

interface JsonPasteSummary {
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
      const scheduledAt = eventBodyOf(decodeEventForm(row.scheduled, ""));
      return {
        title: row.title.trim(),
        position: index,
        ...(row.catalogItemId ? { catalogItemId: row.catalogItemId } : {}),
        ...(row.libraryId ? { libraryId: row.libraryId } : row.libraryKind ? { libraryKind: row.libraryKind } : {}),
        ...recommenderBody(row.recommender, "item", false),
        ...(row.author.trim() ? { author: row.author.trim() } : {}),
        ...(Number.isInteger(year) && year > 1800 ? { year } : {}),
        ...(Number.isInteger(pages) && pages > 0 ? { pageCount: pages } : {}),
        ...(Number.isInteger(runtimeMinutes) && runtimeMinutes > 0 ? { runtimeMinutes } : {}),
        ...(row.mainGenre.trim() ? { mainGenre: row.mainGenre.trim() } : {}),
        ...(scheduledAt ? { scheduledAt } : {}),
        ...(Object.keys(row.attributes).length ? { attributes: row.attributes } : {}),
      };
    });
}

/** The row fields that back a library's built-in properties, by the property's key. */
const NATIVE_ROW_FIELD = {
  author: "author", year: "year", main_genre: "mainGenre", page_count: "pages", runtime_minutes: "runtimeMinutes", scheduled_at: "scheduled",
} as const;

function rowValues(row: CineRow): PropertyValues {
  return {
    author: row.author, year: row.year, main_genre: row.mainGenre, page_count: row.pages, runtime_minutes: row.runtimeMinutes,
    scheduled_at: row.scheduled,
    ...row.extra,
  };
}

/** Whether a book row is still missing the author its library asks for. */
function authorMissing(row: CineRow, properties: LibraryProperty[] | undefined): boolean {
  if (row.libraryKind !== "book" || !row.title.trim() || row.author.trim()) return false;
  return properties?.find((property) => property.key === "author")?.hidden !== true;
}

type EditorLibrary = Pick<ChallengeLibraryRef, "id" | "kind" | "source" | "label">;

/** A row for a catalogue item being put into a challenge, carrying what the catalogue already knows about it. */
function rowFromCatalog(item: CatalogItem, timeZone: string | undefined): CineRow {
  return newCineRow(item.title, {
    catalogItemId: item.id,
    author: item.author ?? "",
    year: item.year ? String(item.year) : "",
    pages: item.pageCount ? String(item.pageCount) : "",
    runtimeMinutes: item.runtimeMinutes ? String(item.runtimeMinutes) : "",
    mainGenre: item.mainGenre ?? "",
    scheduled: encodeEventForm(eventFormOf(item.scheduledAt, timeZone ?? ""), timeZone ?? ""),
  });
}

/**
 * The catalogue as a checklist: search, tick a few — or every match at once — and add them in one go.
 * Items already in the challenge stay listed but can't be ticked again.
 */
function CatalogPicker({ items, used, onAdd }: { items: CatalogItem[] | null; used: ReadonlySet<Id | undefined>; onAdd: (picked: CatalogItem[]) => void }) {
  const t = useTranslations("cineItems");
  const [query, setQuery] = useState("");
  const [ticked, setTicked] = useState<ReadonlySet<Id>>(new Set());
  if (items === null) return <p className="mt-3 p-2 text-xs text-[var(--muted)]">{t("loadingCatalog")}</p>;
  if (!items.length) return <p className="mt-3 p-2 text-xs text-[var(--muted)]">{t("emptyCatalog")}</p>;

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? items.filter((item) => [item.title, item.author, item.mainGenre].some((text) => text?.toLowerCase().includes(needle)))
    : items;
  const selectable = visible.filter((item) => !used.has(item.id));
  const chosen = items.filter((item) => ticked.has(item.id) && !used.has(item.id));
  const allTicked = selectable.length > 0 && selectable.every((item) => ticked.has(item.id));

  function toggle(id: Id) {
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--paper)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] p-2">
        <input
          className={cx(inputClass, "min-h-10 flex-1 basis-40")}
          type="search"
          value={query}
          placeholder={t("catalogSearch")}
          aria-label={t("catalogSearch")}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button variant="secondary" disabled={!selectable.length || allTicked} onClick={() => setTicked((current) => new Set([...current, ...selectable.map((item) => item.id)]))}>
          {t("selectAll", { count: selectable.length })}
        </Button>
        {chosen.length ? <Button variant="ghost" onClick={() => setTicked(new Set())}>{t("clearSelection")}</Button> : null}
      </div>
      <ul className="max-h-72 overflow-y-auto p-1">
        {visible.length ? visible.map((item) => {
          const taken = used.has(item.id);
          return (
            <li key={item.id}>
              <label className={cx("flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--wash)]", taken && "cursor-not-allowed opacity-40")}>
                <input type="checkbox" className="h-4 w-4 flex-none" checked={taken || ticked.has(item.id)} disabled={taken} onChange={() => toggle(item.id)} />
                <span className="min-w-0 flex-1">
                  {item.title}{item.year ? ` (${item.year})` : ""}
                  {item.author ? <span className="text-[var(--muted)]"> · {item.author}</span> : null}
                  {item.mainGenre ? <span className="text-[var(--muted)]"> · {item.mainGenre}</span> : null}
                  {formatRuntime(item.runtimeMinutes) ? <span className="text-[var(--muted)]"> · {formatRuntime(item.runtimeMinutes)}</span> : null}
                </span>
                <span className="flex-none text-xs text-[var(--muted)]">{taken ? t("alreadyAdded") : t("roundsCount", { count: item.roundCount ?? 0 })}</span>
              </label>
            </li>
          );
        }) : <li className="p-2 text-xs text-[var(--muted)]">{t("catalogNoMatch")}</li>}
      </ul>
      <div className="flex items-center justify-between gap-2 border-t border-[var(--line)] p-2">
        <span className="text-xs text-[var(--muted)]">{t("catalogTally", { picked: chosen.length, total: items.length })}</span>
        <Button disabled={!chosen.length} onClick={() => { onAdd(chosen); setTicked(new Set()); }}>{t("addSelected", { count: chosen.length })}</Button>
      </div>
    </div>
  );
}

interface EditorShared {
  members: Member[];
  /** Whose catalogue the "from catalogue" picker reads — a group's or the caller's own. */
  scope: CatalogScope;
  /** The challenge's library (one per challenge); the first entry is used. */
  libraries: readonly EditorLibrary[];
  recommendationsEnabled?: boolean;
  /** Bump to re-read the library's properties after they were edited elsewhere. */
  refreshKey?: number;
  /** The zone a new event date starts in — the browser's when left out. */
  timeZone?: string;
  /** Ask for each item's own date and time even where the library hasn't switched that property on yet (a challenge being created). */
  showSchedule?: boolean;
}

/** The library's properties as the editor offers them, and what would block saving a set of rows. */
function useEditorProperties({ libraries, refreshKey = 0, showSchedule = false }: Pick<EditorShared, "libraries" | "refreshKey" | "showSchedule">) {
  const loaded = useLibrariesProperties(libraries, refreshKey);
  const propertiesFor = (library: Pick<EditorLibrary, "id" | "kind">): LibraryProperty[] | undefined => {
    const properties = loaded.get(library.kind);
    if (!showSchedule || !properties) return properties;
    // Switched on for the challenge being made: the library's own (hidden) property, or a stand-in where it has none yet.
    return properties.some((property) => property.type === "schedule")
      ? properties.map((property) => (property.type === "schedule" ? { ...property, hidden: false } : property))
      : [...properties, { key: "scheduled_at", storage: "native", label: null, type: "schedule", hidden: false, position: 999, canHide: true }];
  };
  const problemOf = (rows: CineRow[]): "author" | "schedule" | null =>
    rows.some((row) => authorMissing(row, loaded.get(row.libraryKind))) ? "author"
      : rows.some((row) => propertiesHaveProblem(propertiesFor({ id: row.libraryId, kind: row.libraryKind }) ?? [], rowValues(row))) ? "schedule"
        : null;
  return { loaded, propertiesFor, problemOf };
}

/** Every property of the given rows, one card each: title, author or who recommended it, the date, then details. */
function RowCards({ rows, onChange, onRemove, shared, openByDefault = false }: {
  rows: CineRow[];
  onChange: (row: CineRow) => void;
  onRemove?: (key: string) => void;
  shared: EditorShared;
  /** Show every property straight away (editing one item), instead of behind "details". */
  openByDefault?: boolean;
}) {
  const t = useTranslations("cineItems");
  const { members, scope, recommendationsEnabled = true, timeZone } = shared;
  const { propertiesFor } = useEditorProperties(shared);
  const source: RecommenderSource = useRecommenderSource(scope, recommendationsEnabled);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const target = shared.libraries[0];
  const update = (row: CineRow, patch: Partial<CineRow>) => onChange({ ...row, ...patch });
  function setRowProperty(row: CineRow, propertyKey: string, propertyValue: string) {
    const nativeField = NATIVE_ROW_FIELD[propertyKey as keyof typeof NATIVE_ROW_FIELD];
    if (nativeField) {
      update(row, { [nativeField]: propertyValue });
      return;
    }
    const custom = (propertiesFor({ id: row.libraryId, kind: row.libraryKind }) ?? []).filter((property) => property.storage === "attribute" && !property.hidden);
    const extra = { ...row.extra, [propertyKey]: propertyValue };
    update(row, { extra, attributes: bodyFromValues(custom, extra, "create").attributes as CineRow["attributes"] });
  }
  if (!target || !rows.length) return null;
  return (
    <ol className="space-y-2">
      {rows.map((row, index) => {
        const open = openByDefault || expanded.has(row.key);
        const properties = propertiesFor({ id: row.libraryId, kind: row.libraryKind || target.kind });
        const authorInline = row.libraryKind === "book" && properties?.find((property) => property.key === "author")?.hidden !== true;
        // An item's own date is what most of these rows are about — asked inline, not behind "details".
        const scheduleProperty = editableProperties(properties ?? []).find((property) => property.type === "schedule") ?? null;
        const detailProperties = editableProperties(properties ?? []).filter((property) => property.type !== "schedule" && !(authorInline && property.key === "author"));
        const recommenderInline = !authorInline && recommendationsEnabled;
        const hasDetails = !openByDefault && (detailProperties.length > 0 || (authorInline && recommendationsEnabled));
        const topRight = authorInline ? (
          <label>
            <span className="sr-only">{t("author")}</span>
            <input className={cx(inputClass, authorMissing(row, properties) ? "border-[var(--danger)]" : "")} value={row.author} maxLength={200} placeholder={t("authorPlaceholder")} onChange={(event) => update(row, { author: event.target.value })} />
          </label>
        ) : recommenderInline ? (
          <RecommenderPicker compact value={row.recommender} onChange={(recommender) => update(row, { recommender })} members={members} source={source} />
        ) : <span />;
        return (
          <li className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-3" key={row.key}>
            <div className={cx("grid gap-2", onRemove || hasDetails ? "sm:grid-cols-[1.6fr_1fr_auto]" : "sm:grid-cols-[1.6fr_1fr]")}>
              <label>
                <span className="sr-only">{t("titleLabel")}</span>
                <input className={inputClass} value={row.title} maxLength={200} placeholder={t("titlePlaceholder")} onChange={(event) => update(row, { title: event.target.value, catalogItemId: undefined })} />
              </label>
              {topRight}
              {onRemove || hasDetails ? (
                <div className="flex items-start gap-1">
                  {hasDetails ? <button type="button" className="min-h-11 rounded-lg px-2 text-xs text-[var(--muted)] hover:text-[var(--ink)]" aria-expanded={open} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next; })}>
                    {open ? t("hideDetails") : t("details")}
                  </button> : null}
                  {onRemove ? <button type="button" className="min-h-11 cursor-pointer rounded-lg px-2 text-xs text-[var(--danger)] hover:underline" onClick={() => onRemove(row.key)}>{t("remove")}</button> : null}
                </div>
              ) : null}
            </div>
            {scheduleProperty ? (
              <div className="mt-3">
                <PropertyInputs properties={[scheduleProperty]} values={rowValues(row)} timeZone={timeZone} onChange={(propertyKey, propertyValue) => setRowProperty(row, propertyKey, propertyValue)} />
              </div>
            ) : null}
            {open ? (
              <div className="mt-2 space-y-3">
                {detailProperties.length ? (
                  <PropertyInputs properties={detailProperties} values={rowValues(row)} timeZone={timeZone} onChange={(propertyKey, propertyValue) => setRowProperty(row, propertyKey, propertyValue)} />
                ) : null}
                {authorInline && recommendationsEnabled ? (
                  <RecommenderPicker value={row.recommender} onChange={(recommender) => update(row, { recommender })} members={members} source={source} />
                ) : null}
              </div>
            ) : null}
            <span className="sr-only">{index + 1}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The "add items" box: paste titles (or a detailed JSON list), or pick from the catalogue, then fill in each
 * new item's library properties right below. Works on a draft; the caller decides when it joins the list.
 */
export function ItemsAddBox({
  draft,
  onDraftChange,
  existing = [],
  onProblem,
  onTargetChange,
  ...shared
}: EditorShared & {
  draft: CineRow[];
  onDraftChange: (rows: CineRow[]) => void;
  /** Items already in the list — a pasted title or a catalogue pick that's already there is skipped. */
  existing?: CineRow[];
  /** Reports what would block saving the draft: a missing book author, or an event date that can't be saved. */
  onProblem?: (problem: "author" | "schedule" | null) => void;
  /** Reports which library new rows are going to (for a caller that shows it, e.g. the list import). */
  onTargetChange?: (library: EditorLibrary) => void;
}) {
  const t = useTranslations("cineItems");
  // A challenge has one library: every item added here goes to it.
  const target = shared.libraries[0];
  const isFilmTarget = target?.kind === "film";
  const isBookTarget = target?.kind === "book";
  const [paste, setPaste] = useState("");
  const [pasteMode, setPasteMode] = useState<"simple" | "json">("simple");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasteSummary, setPasteSummary] = useState<JsonPasteSummary | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const { problemOf } = useEditorProperties(shared);
  const problem = problemOf(draft);
  useEffect(() => { onProblem?.(problem); }, [problem, onProblem]);
  useEffect(() => { if (target) onTargetChange?.(target); }, [target, onTargetChange]);
  const { scope, timeZone } = shared;

  useEffect(() => {
    if (!showCatalog || !target) return;
    const controller = new AbortController();
    apiRequest<{ items: CatalogItem[] }>(API_PATHS.catalogWorkspace(scope).list, { signal: controller.signal })
      .then((response) => setCatalog(response.items))
      .catch(() => setCatalog([]));
    return () => controller.abort();
  }, [showCatalog, target, scope]);
  const catalogInTarget = useMemo(() => (catalog ?? []).filter((item) => item.kind === target?.kind), [catalog, target?.kind]);
  const everyRow = [...existing, ...draft];
  const usedCatalogIds = new Set(everyRow.map((row) => row.catalogItemId).filter(Boolean));
  const stamp = (rows: CineRow[]): CineRow[] => rows.map((row) => ({ ...row, libraryKind: target?.kind ?? "", libraryId: target?.id ?? null }));

  function appendPaste() {
    setPasteError(null);
    setPasteSummary(null);
    const known = new Set(everyRow.map((row) => row.title.trim().toLowerCase()));
    if (pasteMode === "json") {
      try {
        const { rows, summary } = parseJsonItemsPaste(paste, known);
        // Always report what came in — including entries dropped as invalid or
        // duplicated — so nothing disappears without the person being told.
        setPasteSummary(summary);
        if (rows.length) {
          onDraftChange([...draft, ...stamp(rows)]);
          setPaste("");
        }
      } catch (cause) {
        // Raw: these messages quote JSON, and its braces would read as placeholders.
        setPasteError(String(t.raw(cause instanceof Error ? cause.message : "jsonInvalid")));
      }
      return;
    }
    const titles = paste.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!titles.length) return;
    const fresh = titles
      .filter((title) => {
        if (known.has(title.toLowerCase())) return false;
        known.add(title.toLowerCase());
        return true;
      })
      .map((title) => newCineRow(title));
    onDraftChange([...draft, ...stamp(fresh)]);
    setPasteSummary({ total: titles.length, added: fresh.length, invalid: 0, duplicates: titles.length - fresh.length, unknownKeys: [] });
    setPaste("");
  }

  if (!target) return null;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-dashed border-[var(--main-line)] bg-[var(--main-soft)]/50 p-3">
        {isFilmTarget || isBookTarget ? <div className="mb-2 flex gap-1 rounded-full bg-[var(--paper)] p-1 text-xs" role="tablist" aria-label={t("pasteModeAria")}>
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
        </div> : null}
        <label className="block"><span className={labelClass}>{pasteMode === "json" && (isFilmTarget || isBookTarget) ? t("pasteJsonLabel") : t("pasteLabel")}</span>
          <textarea className={cx(inputClass, pasteMode === "json" && (isFilmTarget || isBookTarget) ? "font-mono text-xs" : "")} rows={pasteMode === "json" && (isFilmTarget || isBookTarget) ? 8 : 4} value={paste} onChange={(event) => setPaste(event.target.value)} placeholder={pasteMode === "json" && (isFilmTarget || isBookTarget) ? String(t.raw(isBookTarget ? "pasteJsonPlaceholderBook" : "pasteJsonPlaceholderFilm")) : t("pastePlaceholder")} />
        </label>
        {pasteMode === "json" && (isFilmTarget || isBookTarget) ? <p className="mb-2 text-xs leading-5 text-[var(--muted)]">{t("pasteJsonHint")}</p> : null}
        <StatusMessage error={pasteError} />
        {pasteSummary ? (
          <div className="mb-2 space-y-1">
            <StatusMessage
              error={pasteSummary.added ? null : t("pasteSummaryNone")}
              success={pasteSummary.added
                ? t("pasteSummary", { total: pasteSummary.total, added: pasteSummary.added, invalid: pasteSummary.invalid, duplicates: pasteSummary.duplicates })
                : null}
            />
            {pasteSummary.unknownKeys.length ? (
              <p className="text-[11px] leading-4 text-[var(--muted)]">{t("pasteUnknownKeys", { keys: pasteSummary.unknownKeys.join(", ") })}</p>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={appendPaste} disabled={!paste.trim()}>{t("addPasted")}</Button>
          <Button variant="ghost" onClick={() => setShowCatalog((open) => !open)}>{showCatalog ? t("hideCatalog") : t("fromCatalog")}</Button>
        </div>
        {showCatalog ? (
          <CatalogPicker
            items={catalog === null ? null : catalogInTarget}
            used={usedCatalogIds}
            onAdd={(picked) => onDraftChange([...draft, ...stamp(picked.map((item) => rowFromCatalog(item, timeZone)))])}
          />
        ) : null}
      </div>
      {draft.length ? <p className="text-[13px] font-medium">{t("draftTitle", { count: draft.length })}</p> : null}
      <RowCards
        rows={draft}
        shared={shared}
        onChange={(row) => onDraftChange(draft.map((candidate) => (candidate.key === row.key ? row : candidate)))}
        onRemove={(key) => onDraftChange(draft.filter((row) => row.key !== key))}
      />
    </div>
  );
}

/** One line about an item under its title in the list: author, year, length, genre, who recommended it, its date. */
function useRowSummary(members: Member[], timeZone?: string) {
  const f = useFormatter();
  const t = useTranslations("cineItems");
  return (row: CineRow): string => {
    const bits: string[] = [];
    if (row.author) bits.push(row.author);
    if (row.year) bits.push(row.year);
    const runtime = formatRuntime(Number(row.runtimeMinutes) || null);
    if (runtime) bits.push(runtime);
    if (row.pages) bits.push(t("pagesCount", { count: Number(row.pages) }));
    if (row.mainGenre) bits.push(row.mainGenre);
    if (row.recommender.kind === "member") {
      const name = members.find((member) => member.id === (row.recommender as { userId: Id }).userId)?.name;
      if (name) bits.push(t("pickedBy", { name }));
    }
    const day = row.scheduled ? decodeEventForm(row.scheduled, timeZone ?? "America/Sao_Paulo").date : "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) bits.push(f.dateTime(new Date(`${day}T12:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" }));
    return bits.join(" · ");
  };
}

/**
 * The items of a challenge being created: the list itself first (one line per item, edit or remove), and
 * adding in its own box — paste, the detailed list or the catalogue, with each new item's properties.
 */
export function CineItemsEditor({
  value,
  onChange,
  onProblem,
  ...shared
}: EditorShared & {
  value: CineRow[];
  onChange: (rows: CineRow[]) => void;
  /** Reports what would block saving these rows: a missing book author, or an event date that can't be saved. */
  onProblem?: (problem: "author" | "schedule" | null) => void;
}) {
  const t = useTranslations("cineItems");
  const { problemOf, loaded } = useEditorProperties(shared);
  const tOrganise = useTranslations("organise");
  const { recommenders } = useRecommenderSource(shared.scope, shared.recommendationsEnabled !== false);
  const summary = useRowSummary(shared.members, shared.timeZone);
  const [organising, setOrganising] = useState(false);
  const organiseInput = organiseFromRows(value, loaded.get(shared.libraries[0]?.kind ?? "") ?? [], shared.members, recommenders, (key) => tOrganise(`property.${key}`));
  const problem = problemOf(value);
  useEffect(() => { onProblem?.(problem); }, [problem, onProblem]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<CineRow[]>([]);
  const [draftProblem, setDraftProblem] = useState<"author" | "schedule" | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const editing = value.find((row) => row.key === editingKey) ?? null;
  const flagged = (row: CineRow) => problemOf([row]) !== null;
  if (!shared.libraries[0]) return null;

  return (
    <div>
      <Button className="mb-4 min-h-11 w-full" onClick={() => { setDraft([]); setAdding(true); }}>＋ {t("addItems")}</Button>
      <div className="mb-3 flex min-h-9 items-center justify-between gap-3">
        <p className="text-sm font-medium">{t("listCount", { count: value.length })}</p>
        {canOrganise(organiseInput) ? <Button variant="secondary" className="min-h-9" onClick={() => setOrganising(true)}>{tOrganise("button")}</Button> : null}
      </div>
      {value.length ? (
        <ol className="divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)] bg-[var(--paper)]">
          {value.map((row, index) => (
            <li key={row.key} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-6 flex-none text-right text-xs tabular-nums text-[var(--muted)]">{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{row.title || t("untitled")}</span>
                {summary(row) ? <span className="block truncate text-xs text-[var(--muted)]">{summary(row)}</span> : null}
                {flagged(row) ? <span className="block text-xs text-[var(--danger)]">{t("needsAttention")}</span> : null}
              </span>
              <button type="button" className="min-h-9 cursor-pointer rounded-lg px-2 text-xs text-[var(--muted)] hover:text-[var(--ink)]" onClick={() => setEditingKey(row.key)}>{t("edit")}</button>
              <button type="button" className="min-h-9 cursor-pointer rounded-lg px-2 text-xs text-[var(--danger)] hover:underline" onClick={() => onChange(value.filter((candidate) => candidate.key !== row.key))}>{t("remove")}</button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-2xl border border-dashed border-[var(--line)] px-4 py-8 text-center text-sm text-[var(--muted)]">{t("emptyList")}</p>
      )}

      {adding ? (
        <FormDialog
          title={t("addItems")}
          dirty={draft.length > 0}
          busy={false}
          error={draftProblem === "author" ? t("authorRequired") : null}
          onCancel={() => setAdding(false)}
          submitDisabled={!draft.length || draftProblem !== null}
          submitLabel={t("addCount", { count: draft.length })}
          onSubmit={() => { onChange([...value, ...draft]); setAdding(false); }}
        >
          <ItemsAddBox {...shared} draft={draft} onDraftChange={setDraft} existing={value} onProblem={setDraftProblem} />
        </FormDialog>
      ) : null}

      {organising ? (
        <OrganiseDialog
          input={organiseInput}
          onClose={() => setOrganising(false)}
          onApply={(order) => {
            const byKey = new Map(value.map((row) => [row.key, row]));
            onChange(order.map((key) => byKey.get(key)!).filter(Boolean));
            setOrganising(false);
          }}
        />
      ) : null}

      {editing ? (
        <Dialog title={editing.title || t("untitled")} onClose={() => setEditingKey(null)}>
          <RowCards rows={[editing]} shared={shared} openByDefault onChange={(row) => onChange(value.map((candidate) => (candidate.key === row.key ? row : candidate)))} />
          <div className="mt-4 flex justify-end"><Button onClick={() => setEditingKey(null)}>{t("doneEditing")}</Button></div>
        </Dialog>
      ) : null}
    </div>
  );
}
