"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { API_PATHS, apiRequest } from "../api";
import { BottomSheet } from "../bottom-sheet";
import { AddCatalogItemDialog } from "../catalog-item-dialogs";
import { CatalogRow, type CatalogGroupBy, groupCatalogItems, resolveCoverTop } from "../catalog-views";
import { useCsrf } from "../csrf";
import { ConfirmDialog } from "../dialog";
import { useGoaFormat } from "../format";
import { NewLibraryDialog, LibraryPropertiesDialog } from "../library-dialogs";
import {
  type CatalogScope,
  useCatalogLibraries,
  useLibraryName,
} from "../libraries";
import { useLibraryProperties } from "../property-inputs";
import { recommenderLine } from "../recommender-picker";
import type { CatalogItem, CatalogLibrary, Id, Member } from "../types";
import { BackButton, Button, CheckCircle, cx, EmptyState, FaceEmptyState, SwitchIcon, Select, SlidersIcon, StatusMessage } from "../ui";
import { formatRuntime } from "../utils";

type Sort = "recent" | "title" | "rating" | "date";

/** How many rows a library shows at first, and how many more each "Show more" adds. */
const PAGE_SIZE = 30;
/** A filter list (genres, recommenders) shows this many before its own "+ N more". */
const FACET_SIZE = 6;

// A computer's index can fold away for a wider list; the choice is remembered on this device. Read through an
// external store (like the check-in log's view) so the server render and the first client render agree.
const INDEX_KEY = "goa.catalog.index";
const indexListeners = new Set<() => void>();
function subscribeIndex(listener: () => void) {
  indexListeners.add(listener);
  return () => { indexListeners.delete(listener); };
}
function readIndexOpen(): boolean {
  try { return window.localStorage.getItem(INDEX_KEY) !== "closed"; } catch { return true; }
}
function storeIndexOpen(open: boolean) {
  try { window.localStorage.setItem(INDEX_KEY, open ? "open" : "closed"); } catch { /* private mode: the choice just isn't remembered */ }
  indexListeners.forEach((listener) => listener());
}

/** The quiet pill every control on the toolbar shares; `on` gives it a wash once it narrows the list. */
const chipClass = (on = false) => cx(
  "inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] sm:px-3.5 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25",
  on ? "border-transparent bg-[var(--wash)] text-[var(--ink)] hover:bg-[var(--wash-strong)]" : "border-[var(--line)] text-[var(--ink)] hover:border-[var(--muted)]",
);

/** Sort by: a pill with its name (a phone keeps just the picker) and our picker. */
function CompactSelect<T extends string>({ label, value, onChange, options, className }: { label: string; value: T; onChange: (value: T) => void; options: Array<{ value: T; label: string }>; className?: string }) {
  return (
    <div className={cx(className, "inline-flex min-h-9 min-w-0 items-center gap-1.5 rounded-full border border-[var(--line)] pl-3 pr-2 sm:pl-3.5 sm:pr-2.5 text-[13px] transition focus-within:ring-4 focus-within:ring-[var(--main)]/25 hover:border-[var(--muted)]")}>
      <span className="hidden flex-none text-xs text-[var(--muted)] sm:inline">{label}</span>
      <Select look="bare" ariaLabel={label} value={value} onChange={onChange} options={options} className="flex-1 text-[var(--ink)]" />
    </div>
  );
}

/**
 * One line of the index: a library (a dot marks the open one) or a filter (a round check, ticked when on),
 * with its count at the end.
 */
function IndexRow({ label, count, on, onClick, box = false }: { label: string; count?: number; on: boolean; onClick: () => void; box?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        "flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg text-left text-[15px] transition hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25 lg:min-h-9 lg:text-sm",
        on ? "font-medium text-[var(--ink)]" : "text-[var(--muted)]",
      )}
    >
      {box ? (
        <CheckCircle on={on} className="!h-4 !w-4" />
      ) : (
        <span aria-hidden="true" className={cx("h-1.5 w-1.5 flex-none rounded-full", on ? "bg-[var(--main)]" : "bg-transparent")} />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count === undefined ? null : <span className="flex-none text-xs font-normal text-[var(--muted)]">{count}</span>}
    </button>
  );
}

/** Three lines, the magnifier's size: opens the filters (the sidebar on a computer, left of the search; a sheet on smaller screens, at its right). */
const MenuIcon = () => (
  <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" /></svg>
);

const SearchIcon = () => (
  <svg viewBox="0 0 20 20" className="h-[18px] w-[18px] flex-none text-[var(--muted)]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="9" cy="9" r="5.5" /><path d="m13.2 13.2 3.8 3.8" /></svg>
);

/**
 * The catalogue of one space — a person's own or a group's — as a set of
 * libraries. Same screen for both; the group version just gates editing on the
 * viewer being able to manage it.
 */
export function CatalogWorkspaceScreen({
  scope,
  title,
  subtitle,
  backLabel,
  canManage,
  recommendationsEnabled,
  onBack,
  onOpenItem,
}: {
  scope: CatalogScope;
  title: string;
  subtitle?: string;
  backLabel: string;
  canManage: boolean;
  members: Member[];
  recommendationsEnabled: boolean;
  onBack: () => void;
  onOpenItem: (itemId: Id) => void;
}) {
  const t = useTranslations("personalCatalog");
  const tItem = useTranslations("catalog");
  const tl = useTranslations("libraries");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const libraryName = useLibraryName();
  const { data: libraries, error: librariesError, reload: reloadLibraries } = useCatalogLibraries(scope);
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [itemsNonce, setItemsNonce] = useState(0);
  const [activeKind, setActiveKind] = useState<string | null>(null);
  const [recommenderFilter, setRecommenderFilter] = useState("");
  const [query, setQuery] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [unratedOnly, setUnratedOnly] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [openFacets, setOpenFacets] = useState<string[]>([]);
  const indexOpen = useSyncExternalStore(subscribeIndex, readIndexOpen, () => true);
  const toggleIndex = () => storeIndexOpen(!indexOpen);
  // On a phone the index lives in two sheets: the library switcher and the filters.
  const [sheet, setSheet] = useState<"libraries" | "filters" | null>(null);
  const [sort, setSort] = useState<Sort>("recent");
  const [groupBy, setGroupBy] = useState<CatalogGroupBy>("none");
  const [dialog, setDialog] = useState<"add" | "new" | "properties" | null>(null);
  // The library the settings dialog is about — not always the one on screen.
  const [dialogKind, setDialogKind] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Tidying up: show only what no challenge holds, tick items, remove them together.
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<Id>>(new Set());
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const csrf = useCsrf();
  const scopeId = scope === "personal" ? "personal" : scope.groupId;

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ items: CatalogItem[] }>(API_PATHS.catalogWorkspace(scope).list, { signal: controller.signal })
      .then((response) => { setItems(response.items); setItemsError(null); })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setItems((current) => current ?? []);
        setItemsError(f.error(cause));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeId, itemsNonce]);

  const reloadAll = () => { reloadLibraries(); setItemsNonce((value) => value + 1); };

  // Libraries a person can see as cards: the real ones. A built-in (Screens/Pages) shows up once it has an item.
  const tabs: CatalogLibrary[] = useMemo(() => libraries ?? [], [libraries]);
  const isUnused = (item: CatalogItem) => (item.challengeCount ?? item.roundCount ?? 0) === 0;
  const countByKind = useMemo(() => {
    const counts = new Map<string, { total: number; unused: number }>();
    for (const item of items ?? []) {
      const entry = counts.get(item.kind) ?? { total: 0, unused: 0 };
      entry.total += 1;
      if ((item.challengeCount ?? item.roundCount ?? 0) === 0) entry.unused += 1;
      counts.set(item.kind, entry);
    }
    return counts;
  }, [items]);
  const fallbackKind = tabs.length
    ? [...tabs].sort((a, b) => (countByKind.get(b.kind)?.total ?? 0) - (countByKind.get(a.kind)?.total ?? 0))[0].kind
    : null;
  const kind = activeKind && tabs.some((library) => library.kind === activeKind) ? activeKind : fallbackKind;
  const library = tabs.find((entry) => entry.kind === kind) ?? null;
  const dialogLibrary = tabs.find((entry) => entry.kind === dialogKind) ?? null;
  const scoped = useMemo(() => (items ?? []).filter((item) => item.kind === kind), [items, kind]);
  const isBuiltIn = kind === "film" || kind === "book";
  const loading = items === null || libraries === null;
  // A property someone hid stops showing on lists too — the values stay saved.
  const { properties: libraryProperties } = useLibraryProperties(library ? { id: library.id, kind: library.kind } : null, itemsNonce);
  const hidden = useMemo(() => new Set((libraryProperties ?? []).filter((property) => property.hidden).map((property) => property.key)), [libraryProperties]);

  function openLibraryDialog(entry: CatalogLibrary) {
    setNotice(null);
    setDialogKind(entry.kind);
    setDialog("properties");
  }

  function chooseLibrary(next: string) {
    setActiveKind(next);
    clearFilters();
    setGroupBy("none");
    setQuery("");
    setShown(PAGE_SIZE);
  }

  function clearFilters() {
    setRecommenderFilter("");
    setGenres([]);
    setUnratedOnly(false);
    setUnusedOnly(false);
  }

  // Who brought things into this library, for the "recommended by" filter.
  const recommenders = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of scoped) if (item.recommendedBy) seen.set(`${item.recommendedBy.kind}:${item.recommendedBy.id}`, item.recommendedBy.name);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [scoped]);
  const activeFilter = recommenderFilter && (recommenderFilter === "none" || recommenders.some(([key]) => key === recommenderFilter)) ? recommenderFilter : "";
  const unusedCount = countByKind.get(kind ?? "")?.unused ?? 0;
  // Once the last unused item is gone the chip goes with it, so the filter can't be left stuck on.
  const onlyUnused = unusedOnly && unusedCount > 0;
  // The library's genres, for the genre filter (gone when the library hides its genre).
  const genreNames = useMemo(() => (hidden.has("main_genre") ? [] : [...new Set(scoped.map((item) => item.mainGenre?.trim() ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b))), [scoped, hidden]);
  const activeGenres = useMemo(() => genres.filter((genre) => genreNames.includes(genre)), [genres, genreNames]);
  const needle = query.trim().toLocaleLowerCase();
  const filtered = useMemo(() => scoped.filter((item) => {
    if (onlyUnused && (item.challengeCount ?? item.roundCount ?? 0) !== 0) return false;
    if (unratedOnly && item.ratingAvg !== null && item.ratingAvg !== undefined) return false;
    if (activeGenres.length && !activeGenres.includes(item.mainGenre?.trim() ?? "")) return false;
    if (needle && ![item.title, item.author, item.mainGenre].some((field) => field?.toLocaleLowerCase().includes(needle))) return false;
    if (!activeFilter) return true;
    if (activeFilter === "none") return !item.recommendedBy && !item.originNote;
    return item.recommendedBy ? `${item.recommendedBy.kind}:${item.recommendedBy.id}` === activeFilter : false;
  }), [scoped, activeFilter, onlyUnused, unratedOnly, activeGenres, needle]);
  // Only offered where the library keeps an event date (a match's kickoff) on its items.
  const hasDates = scoped.some((item) => item.scheduledAt);
  const activeSort: Sort = sort === "date" && !hasDates ? "recent" : sort;
  const startOf = (item: CatalogItem) => (item.scheduledAt ? new Date(item.scheduledAt.startsAt).getTime() : Infinity);
  const addedAt = (item: CatalogItem) => (item.createdAt ? Date.parse(item.createdAt) : 0);
  const sorted = useMemo(() => [...filtered].sort((left, right) =>
    activeSort === "rating"
      ? (right.ratingAvg ?? -1) - (left.ratingAvg ?? -1) || left.title.localeCompare(right.title)
      : activeSort === "date"
        ? startOf(left) - startOf(right) || left.title.localeCompare(right.title)
        : activeSort === "recent"
          ? addedAt(right) - addedAt(left) || left.title.localeCompare(right.title)
          : left.title.localeCompare(right.title),
  ), [filtered, activeSort]);
  // Only the first rows are drawn; "Show more" brings the next page.
  const groups = useMemo(() => groupCatalogItems(sorted.slice(0, shown), groupBy), [sorted, groupBy, shown]);
  const hiddenCount = Math.max(0, sorted.length - shown);

  const rated = scoped.filter((item) => item.ratingAvg !== null && item.ratingAvg !== undefined);
  const average = rated.length ? Math.round((rated.reduce((sum, item) => sum + (item.ratingAvg ?? 0), 0) / rated.length) * 100) / 100 : null;

  /** What sets an item apart, minus whatever the cover's top slot already carries (year by default) and who recommended it. */
  function detailsFor(item: CatalogItem): string[] {
    const topSlot = library?.coverTopProperty ?? "none";
    const custom = (item.attributes ?? [])
      .filter((attribute) => attribute.key !== topSlot)
      .map((attribute) => attribute.type === "boolean" ? `${attribute.label}: ${attribute.value ? tc("yes") : tc("no")}` : `${attribute.label}: ${String(attribute.value)}`);
    return [
      topSlot === "scheduled_at" ? null : item.scheduledAt ? f.eventWhen(item.scheduledAt) : null,
      hidden.has("author") || topSlot === "author" ? null : item.author,
      hidden.has("year") || topSlot === "year" || item.year === null || item.year === undefined ? null : String(item.year),
      hidden.has("main_genre") || topSlot === "main_genre" ? null : item.mainGenre,
      hidden.has("runtime_minutes") || topSlot === "runtime_minutes" ? null : formatRuntime(item.runtimeMinutes),
      ...custom,
    ].filter((part): part is string => Boolean(part));
  }
  const challengesOf = (item: CatalogItem) => item.challengeCount ?? item.roundCount ?? 0;
  const ratingLabel = (item: CatalogItem) => (item.ratingAvg === null || item.ratingAvg === undefined ? tItem("notRated") : tItem("ratedAria", { value: item.ratingAvg }));
  /** The server resolves an unconfigured cover to the first numeric property. */
  const topOf = (item: CatalogItem) => resolveCoverTop(item, library?.coverTopProperty, f);
  /** Everything shown under an item's name, most telling first: a phone keeps the first two, wider screens all of it. */
  function metaFor(item: CatalogItem): string[] {
    return [
      ...detailsFor(item),
      recommendationsEnabled ? recommenderLine(item.recommendedBy, item.originNote, (name) => t("recommendedBy", { name }), (text) => t("origin", { text })) : null,
    ].filter((part): part is string => Boolean(part));
  }

  function togglePicked(ids: Id[], on: boolean) {
    setPicked((current) => {
      const next = new Set(current);
      for (const id of ids) if (on) next.add(id); else next.delete(id);
      return next;
    });
  }
  function stopSelecting() { setSelecting(false); setPicked(new Set()); }
  const pickedHere = sorted.filter((item) => picked.has(item.id));
  const allHerePicked = sorted.length > 0 && pickedHere.length === sorted.length;

  async function removePicked() {
    const ids = pickedHere.map((item) => item.id);
    const result = await apiRequest<{ removed: number; skipped: Array<{ id: Id; title: string | null; reason: string }> }>(API_PATHS.catalogWorkspace(scope).remove, {
      method: "POST", body: { itemIds: ids }, csrfToken: csrf,
    });
    setConfirmingRemoval(false);
    // Tidying often goes in rounds: stay in selection while more unused items are waiting.
    if (onlyUnused && unusedCount - result.removed > 0) setPicked(new Set());
    else stopSelecting();
    setNotice(result.skipped.length ? t("removedSome", { removed: result.removed, skipped: result.skipped.length }) : t("removedMany", { count: result.removed }));
    reloadAll();
  }

  const groupOptions: Array<{ value: CatalogGroupBy; label: string }> = [
    { value: "none", label: t("group.none") },
    { value: "genre", label: t("group.genre") },
    { value: "decade", label: t("group.decade") },
    { value: "year", label: t("group.year") },
  ];
  const sortOptions: Array<{ value: Sort; label: string }> = [
    { value: "recent", label: t("sortRecent") },
    { value: "title", label: t("sortTitle") },
    { value: "rating", label: t("sortRating") },
    ...(hasDates ? [{ value: "date" as const, label: t("sortDate") }] : []),
  ];
  const groupLabel = (label: string) => label || (groupBy === "genre" ? t("noGenre") : t("undated"));
  const recommenderName = (key: string) => (key === "none" ? t("recommenderNone") : recommenders.find(([entry]) => entry === key)?.[1] ?? "");
  // What narrows the list, each removable on its own from the toolbar.
  const activeChips: Array<{ key: string; label: string; remove: () => void }> = [
    ...activeGenres.map((genre) => ({ key: `genre:${genre}`, label: genre, remove: () => setGenres(activeGenres.filter((entry) => entry !== genre)) })),
    ...(activeFilter ? [{ key: "recommender", label: recommenderName(activeFilter), remove: () => setRecommenderFilter("") }] : []),
    ...(unratedOnly ? [{ key: "unrated", label: t("notRatedFilter"), remove: () => setUnratedOnly(false) }] : []),
    ...(onlyUnused ? [{ key: "unused", label: t("unusedOnly"), remove: () => setUnusedOnly(false) }] : []),
  ];
  const narrowed = Boolean(activeChips.length || needle);

  const libraryIndex = (
    <div>
      {tabs.map((entry) => {
        const active = entry.kind === kind;
        return (
          // The open library keeps its dot; its settings sit just before the name, in the same 12px column as the
          // "＋" of "＋ Library" below. On a computer they show on the open library, or on a row under the pointer.
          <div key={entry.id} className={cx("group flex min-h-11 items-center gap-2.5 text-[15px] lg:min-h-9 lg:text-sm", active ? "font-medium text-[var(--ink)]" : "text-[var(--muted)]")}>
            <span aria-hidden="true" className={cx("h-1.5 w-1.5 flex-none rounded-full", active ? "bg-[var(--main)]" : "bg-transparent")} />
            <button
              type="button"
              aria-label={`${tl("libraryActions")}: ${libraryName(entry)}`}
              title={tl("libraryActions")}
              onClick={() => { setSheet(null); openLibraryDialog(entry); }}
              // -m-2 / p-2: a bigger target around the 12px icon without moving it out of its column.
              className={cx(
                "-m-2 grid flex-none cursor-pointer place-items-center rounded-full p-2 text-[var(--muted)] transition hover:bg-[var(--wash)] hover:text-[var(--ink)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25",
                !active && "lg:opacity-0 lg:group-hover:opacity-100",
              )}
            >
              <SlidersIcon className="h-3 w-3" />
            </button>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => { chooseLibrary(entry.kind); setSheet(null); }}
              className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg text-left transition hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25 lg:min-h-9"
            >
              <span className="min-w-0 flex-1 truncate">{libraryName(entry)}</span>
              <span className="flex-none text-xs font-normal text-[var(--muted)]">{countByKind.get(entry.kind)?.total ?? 0}</span>
            </button>
          </div>
        );
      })}
      {canManage ? (
        <button type="button" onClick={() => { setSheet(null); setDialog("new"); }} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-left text-[15px] text-[var(--muted)] transition hover:text-[var(--ink)] lg:min-h-9 lg:text-sm">
          <span aria-hidden="true" className="w-1.5 flex-none" />
          <svg viewBox="0 0 12 12" className="h-3 w-3 flex-none" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9" /></svg>
          {tl("addLibrary")}
        </button>
      ) : null}
    </div>
  );

  const facetHeading = "mb-1 text-xs text-[var(--muted)]";
  /** The head of a long filter list, with "+ N more" (in the ticks' column) to open the rest. */
  function facetRows<T>(key: string, rows: T[], render: (row: T) => ReactNode) {
    const open = openFacets.includes(key) || rows.length <= FACET_SIZE + 1;
    return (
      <>
        {(open ? rows : rows.slice(0, FACET_SIZE)).map(render)}
        {open ? null : (
          <button type="button" onClick={() => setOpenFacets([...openFacets, key])} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-left text-[15px] text-[var(--muted)] transition hover:text-[var(--ink)] lg:min-h-9 lg:text-sm">
            <span aria-hidden="true" className="grid w-4 flex-none place-items-center">
              <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M6 1.5v9M1.5 6h9" /></svg>
            </span>
            {t("moreFacets", { count: rows.length - FACET_SIZE })}
          </button>
        )}
      </>
    );
  }
  const facets = (
    <div className="flex flex-col gap-7">
      {genreNames.length > 1 ? (
        <div>
          <p className={facetHeading}>{t("group.genre")}</p>
          {facetRows("genre", genreNames, (genre) => {
            const on = activeGenres.includes(genre);
            return <IndexRow key={genre} box label={genre} on={on} count={scoped.filter((item) => item.mainGenre?.trim() === genre).length} onClick={() => setGenres(on ? activeGenres.filter((entry) => entry !== genre) : [...activeGenres, genre])} />;
          })}
        </div>
      ) : null}
      {recommendationsEnabled && recommenders.length ? (
        <div>
          <p className={facetHeading}>{t("recommenderHeading")}</p>
          {facetRows("recommender", [...recommenders, ["none", t("recommenderNone")] as [string, string]], ([key, name]) => (
            <IndexRow key={key} box label={name} on={activeFilter === key} onClick={() => setRecommenderFilter(activeFilter === key ? "" : key)} />
          ))}
        </div>
      ) : null}
      <div>
        <p className={facetHeading}>{t("showOnly")}</p>
        <IndexRow box label={t("notRatedFilter")} on={unratedOnly} onClick={() => setUnratedOnly(!unratedOnly)} />
        {canManage && unusedCount > 0 ? (
          <IndexRow box label={t("unusedOnly")} count={unusedCount} on={onlyUnused} onClick={() => { const next = !onlyUnused; setUnusedOnly(next); if (next) setSelecting(true); }} />
        ) : null}
      </div>
      {isBuiltIn ? (
        <div>
          <p className={facetHeading}>{t("groupByLabel")}</p>
          {groupOptions.map((option) => <IndexRow key={option.value} label={option.label} on={groupBy === option.value} onClick={() => setGroupBy(option.value)} />)}
        </div>
      ) : null}
    </div>
  );

  return (
    // While picking, a phone keeps room at the bottom for the selection bar floating over the dock.
    <main className={cx("px-4 py-8 sm:px-6 sm:py-12 sm:pb-24 lg:px-20", selecting ? "pb-44" : "pb-24")}>
      <BackButton onClick={onBack} label={backLabel} className="mb-6" />

      {/* A computer reads the page's name as its title; a phone keeps it small above the library switcher. */}
      <h1 className="text-xs text-[var(--muted)] lg:mb-8 lg:text-4xl lg:font-medium lg:tracking-[-0.045em] lg:text-[var(--ink)]">{title}</h1>
      {subtitle ? <p className="mt-2 hidden max-w-2xl text-sm leading-6 text-[var(--muted)] lg:block">{subtitle}</p> : null}

      <StatusMessage error={librariesError ?? itemsError} success={notice} />

      {loading ? (
        <p className="mt-6 text-sm text-[var(--muted)]">{t("loading")}</p>
      ) : !tabs.length ? (
        // The same quiet, unboxed empty state as Updates: no actions compete with the page heading.
        <div className="mt-6">
          <FaceEmptyState title={t("emptyTitle")} />
        </div>
      ) : library ? (
        <div className="lg:flex lg:items-start lg:gap-14">
          <aside id="catalog-index" className={cx("hidden w-56 flex-none lg:flex-col lg:gap-7", indexOpen && "lg:flex")} aria-label={tl("tabsLabel")}>
            <div>
              {/* As tall as the search row, so this heading and the search text share a line. */}
              <p className="flex h-11 items-center text-xs text-[var(--muted)]">{tl("tabsLabel")}</p>
              {libraryIndex}
            </div>
            {scoped.length ? facets : null}
          </aside>

          <section className="min-w-0 flex-1" aria-label={libraryName(library)}>
            <div className="mt-0.5 flex items-center justify-between gap-3 lg:hidden">
              <button
                type="button"
                onClick={() => setSheet("libraries")}
                aria-haspopup="dialog"
                aria-label={`${t("chooseLibrary")}: ${libraryName(library)}`}
                className="inline-flex min-h-11 min-w-0 cursor-pointer items-center gap-2.5 text-3xl font-medium tracking-[-0.045em]"
              >
                <span className="truncate">{libraryName(library)}</span>
                <SwitchIcon className="h-5 w-5 flex-none text-[var(--muted)]" />
              </button>
              {canManage ? (
                <button
                  type="button"
                  onClick={() => { setNotice(null); setDialog("add"); }}
                  aria-label={t("addItem")}
                  title={t("addItem")}
                  className="grid h-11 w-11 flex-none cursor-pointer place-items-center rounded-full bg-[var(--main)] text-white shadow-[var(--elevate-1)] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25 sm:hidden"
                >
                  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
                </button>
              ) : null}
            </div>

            {/* Search takes the row; Sort, Select and ＋ Item sit together at its end (on a phone, the row below it, with Filter). */}
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-3 lg:mt-0">
              <div className="flex min-w-0 basis-full items-center gap-3 sm:mr-6 sm:basis-0 sm:flex-1">
              <button
                type="button"
                onClick={toggleIndex}
                aria-expanded={indexOpen}
                aria-controls="catalog-index"
                aria-label={indexOpen ? t("hideIndex") : t("showIndex")}
                title={indexOpen ? t("hideIndex") : t("showIndex")}
                className="-ml-2 -mr-1 hidden h-9 w-9 flex-none cursor-pointer place-items-center rounded-full text-[var(--muted)] transition hover:bg-[var(--wash)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25 lg:grid"
              >
                <MenuIcon />
              </button>
              <label className="group relative flex h-11 min-w-0 flex-1 cursor-text items-center gap-2.5">
                <SearchIcon />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("searchPlaceholder", { name: libraryName(library) })}
                  aria-label={t("searchPlaceholder", { name: libraryName(library) })}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted)] [&::-webkit-search-cancel-button]:appearance-none"
                />
                {/* A hairline that grows in from the left while you type (and stays while there's text). */}
                <span aria-hidden="true" className={cx("pointer-events-none absolute bottom-0 left-0 h-px bg-[var(--line)] transition-[width] duration-500 ease-[cubic-bezier(.22,1,.36,1)] group-focus-within:w-full motion-reduce:transition-none", query ? "w-full" : "w-0")} />
              </label>
              <button
                type="button"
                onClick={() => setSheet("filters")}
                aria-label={t("filter")}
                title={t("filter")}
                className="relative -mr-1 grid h-9 w-9 flex-none cursor-pointer place-items-center rounded-full text-[var(--muted)] transition hover:bg-[var(--wash)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25 lg:hidden"
              >
                <MenuIcon />
                {activeChips.length ? <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--main)]" /> : null}
              </button>
              </div>
              {/* Sort and Select are left off phones for now. */}
              <div className="flex flex-1 items-center justify-end gap-2 max-sm:hidden sm:flex-none">
                
                {scoped.length ? <CompactSelect<Sort> className="max-sm:hidden" label={t("sortLabel")} value={activeSort} onChange={setSort} options={sortOptions} /> : null}
                {canManage && scoped.length ? (
                  <button type="button" aria-pressed={selecting} onClick={() => (selecting ? stopSelecting() : setSelecting(true))} className={cx(chipClass(selecting), "max-sm:hidden")}>
                    {selecting ? t("doneSelecting") : t("select")}
                  </button>
                ) : null}
                {canManage ? <Button className="!min-h-9 !rounded-full !px-3.5 !text-[13px] max-sm:!hidden" onClick={() => { setNotice(null); setDialog("add"); }}>＋ {t("newItem")}</Button> : null}
              </div>
            </div>

            {activeChips.length ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {activeChips.map((chip) => (
                  <button key={chip.key} type="button" onClick={chip.remove} aria-label={t("removeFilter", { name: chip.label })} className={chipClass(true)}>
                    {chip.label}<span aria-hidden="true" className="text-[var(--muted)]">×</span>
                  </button>
                ))}
              </div>
            ) : null}

            {scoped.length ? (
              <p className="mt-5 text-sm text-[var(--muted)]" aria-live="polite">
                <strong className="font-medium text-[var(--ink)]">{narrowed ? t("resultOf", { shown: sorted.length, total: scoped.length }) : t("resultCount", { count: scoped.length })}</strong>
                {average !== null ? ` · ${t("averageRating", { value: average })}` : ""}
              </p>
            ) : null}

            {selecting ? (
              <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-50 flex items-center gap-2 rounded-full bg-[var(--wash)] p-1.5 text-[13px] sm:text-sm shadow-[var(--elevate-2)] sm:static sm:mt-4 sm:shadow-none" role="region" aria-label={t("selectionBar")}>
                <Button variant="secondary" className="!rounded-full max-sm:!px-3 max-sm:!text-[13px]" disabled={!sorted.length} onClick={() => togglePicked(sorted.map((item) => item.id), !allHerePicked)}>
                  {allHerePicked ? t("clearSelection") : t("selectAll", { count: sorted.length })}
                </Button>
                <strong className="min-w-0 truncate font-medium">{t("pickedTally", { count: pickedHere.length })}</strong>
                <span className="flex-1" />
                <Button variant="danger" className="!rounded-full max-sm:!px-3 max-sm:!text-[13px]" disabled={!pickedHere.length} onClick={() => setConfirmingRemoval(true)}>{t("removePicked", { count: pickedHere.length })}</Button>
              </div>
            ) : null}

            <div className="mt-3">
              {!scoped.length ? (
                <EmptyState
                  title={tl("emptyLibrary", { name: libraryName(library) })}
                  onClick={canManage ? () => setDialog("add") : undefined}
                />
              ) : !sorted.length ? (
                <FaceEmptyState title={t("noMatches")} />
              ) : (
                <div className="space-y-10">
                  {groups.map((group) => (
                    <section key={group.key} aria-label={groupBy === "none" ? undefined : groupLabel(group.label)}>
                      {groupBy !== "none" ? (
                        <h2 className="mb-2 mt-4 flex items-baseline gap-2.5 text-lg font-light tracking-[-0.02em]">
                          {groupLabel(group.label)}
                          <span className="text-xs text-[var(--muted)]">{group.items.length}</span>
                        </h2>
                      ) : null}
                      <ul className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
                        {group.items.map((item) => {
                          const unused = isUnused(item);
                          return (
                            <li key={item.id}>
                              <CatalogRow
                                title={item.title}
                                year={topOf(item)}
                                avg={item.ratingAvg}
                                badgeHidden={library.coverBadgeHidden}
                                ratingLabel={ratingLabel(item)}
                                meta={metaFor(item)}
                                note={unused ? t("notInChallenge") : t("rounds", { count: challengesOf(item) })}
                                noteTone={unused && canManage ? "warn" : "muted"}
                                selecting={selecting}
                                picked={picked.has(item.id)}
                                onPick={(on) => togglePicked([item.id], on)}
                                onOpen={() => onOpenItem(item.id)}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))}
                  {hiddenCount > 0 ? (
                    <button type="button" onClick={() => setShown(shown + PAGE_SIZE)} className={cx(chipClass(), "mx-auto flex")}>
                      {t("showMore", { count: Math.min(PAGE_SIZE, hiddenCount) })}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {sheet === "libraries" ? (
        // pr-2.5: the counts end where the close icon's circle ends.
        <BottomSheet title={tl("tabsLabel")} onClose={() => setSheet(null)}><div className="pr-2.5">{libraryIndex}</div></BottomSheet>
      ) : null}
      {sheet === "filters" ? (
        <BottomSheet title={t("filter")} onClose={() => setSheet(null)}>
          <div className="pr-2.5">{facets}</div>
          <div className="mt-7 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={clearFilters}>{t("clearShort")}</Button>
            <Button onClick={() => setSheet(null)}>{t("showItems")}</Button>
          </div>
        </BottomSheet>
      ) : null}

      {dialog === "add" ? (
        <AddCatalogItemDialog
          scope={scope}
          libraries={libraries ?? []}
          initialKind={kind}
          onCancel={() => setDialog(null)}
          onAdded={({ reused }) => {
            setDialog(null);
            setNotice(reused ? t("reusedNotice") : t("addedNotice"));
            reloadAll();
          }}
        />
      ) : null}
      {dialog === "new" ? (
        <NewLibraryDialog
          scope={scope}
          onCancel={() => setDialog(null)}
          onCreated={(made) => { setDialog(null); chooseLibrary(made.kind); reloadAll(); }}
        />
      ) : null}
      {dialog === "properties" && dialogLibrary ? (
        <LibraryPropertiesDialog
          scope={scope}
          library={dialogLibrary}
          canEdit={canManage}
          itemCount={countByKind.get(dialogLibrary.kind)?.total ?? 0}
          onClose={() => setDialog(null)}
          onChanged={reloadAll}
          onDeleted={(name) => {
            setDialog(null);
            if (dialogLibrary.kind === kind) { chooseLibrary(""); stopSelecting(); }
            setNotice(tl("deleted", { name }));
            reloadAll();
          }}
        />
      ) : null}
      {confirmingRemoval ? (
        <ConfirmDialog
          title={t("removeManyTitle", { count: pickedHere.length })}
          body={t("removeManyBody")}
          busyLabel={tc("saving")}
          danger
          onClose={() => setConfirmingRemoval(false)}
          onConfirm={removePicked}
        />
      ) : null}
    </main>
  );
}
