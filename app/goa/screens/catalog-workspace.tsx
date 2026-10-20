"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

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
import { recommenderLine, useRecommenderSource } from "../recommender-picker";
import type { CatalogItem, CatalogLibrary, Id, Member } from "../types";
import { BackButton, Button, cx, EmptyState, Select, SlidersIcon, StatusMessage } from "../ui";
import { formatRuntime } from "../utils";

type Sort = "recent" | "title" | "rating" | "date";

/** The quiet pill every control on the toolbar shares; `on` gives it a wash once it narrows the list. */
const chipClass = (on = false) => cx(
  "inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm sm:px-3.5 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25",
  on ? "border-transparent bg-[var(--wash)] text-[var(--ink)] hover:bg-[var(--wash-strong)]" : "border-[var(--line)] text-[var(--ink)] hover:border-[var(--muted)]",
);

/** Sort by: a pill with its name (a phone keeps just the picker) and our picker. */
function CompactSelect<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (value: T) => void; options: Array<{ value: T; label: string }> }) {
  return (
    <div className="inline-flex min-h-9 min-w-0 items-center gap-1.5 rounded-full border border-[var(--line)] pl-3 pr-2 sm:pl-3.5 sm:pr-2.5 text-sm transition focus-within:ring-4 focus-within:ring-[var(--main)]/25 hover:border-[var(--muted)]">
      <span className="hidden flex-none text-xs text-[var(--muted)] sm:inline">{label}</span>
      <Select look="bare" ariaLabel={label} value={value} onChange={onChange} options={options} className="text-[var(--ink)]" />
    </div>
  );
}

/**
 * One line of the index: a library (a dot marks the open one) or a filter (a small box, ticked when on),
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
        <span aria-hidden="true" className={cx("grid h-4 w-4 flex-none place-items-center rounded-[5px] border text-[10px] leading-none", on ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--muted)]/50")}>{on ? "✓" : ""}</span>
      ) : (
        <span aria-hidden="true" className={cx("h-1.5 w-1.5 flex-none rounded-full", on ? "bg-[var(--main)]" : "bg-transparent")} />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count === undefined ? null : <span className="flex-none text-xs font-normal text-[var(--muted)]">{count}</span>}
    </button>
  );
}

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
  members,
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
  const source = useRecommenderSource(scope, recommendationsEnabled);
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
  const groups = useMemo(() => groupCatalogItems(sorted, groupBy), [sorted, groupBy]);

  const rated = scoped.filter((item) => item.ratingAvg !== null && item.ratingAvg !== undefined);
  const average = rated.length ? Math.round((rated.reduce((sum, item) => sum + (item.ratingAvg ?? 0), 0) / rated.length) * 100) / 100 : null;

  /** What sets an item apart, minus whatever the cover's top slot already carries (year by default) and who recommended it. */
  function detailsFor(item: CatalogItem): string[] {
    const topSlot = library?.coverTopProperty ?? "year";
    const custom = (item.attributes ?? [])
      .filter((attribute) => attribute.key !== topSlot)
      .map((attribute) => attribute.type === "boolean" ? `${attribute.label}: ${attribute.value ? tc("yes") : tc("no")}` : `${attribute.label}: ${String(attribute.value)}`);
    return [
      topSlot === "scheduled_at" ? null : item.scheduledAt ? f.eventWhen(item.scheduledAt) : null,
      hidden.has("author") || topSlot === "author" ? null : item.author,
      hidden.has("main_genre") || topSlot === "main_genre" ? null : item.mainGenre,
      hidden.has("runtime_minutes") || topSlot === "runtime_minutes" ? null : formatRuntime(item.runtimeMinutes),
      ...custom,
    ].filter((part): part is string => Boolean(part));
  }
  const challengesOf = (item: CatalogItem) => item.challengeCount ?? item.roundCount ?? 0;
  const ratingLabel = (item: CatalogItem) => (item.ratingAvg === null || item.ratingAvg === undefined ? tItem("notRated") : tItem("ratedAria", { value: item.ratingAvg }));
  const yearOf = (item: CatalogItem) => (hidden.has("year") ? null : item.year);
  /** The library's own choice for the cover's top slot — falls back to `yearOf` (hidden-aware) when it hasn't picked one. */
  const topOf = (item: CatalogItem) => (library?.coverTopProperty ? resolveCoverTop(item, library.coverTopProperty, f) : yearOf(item));
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
          <div key={entry.id} className="group flex items-center gap-1">
            <IndexRow label={libraryName(entry)} count={countByKind.get(entry.kind)?.total ?? 0} on={active} onClick={() => { chooseLibrary(entry.kind); setSheet(null); }} />
            <button
              type="button"
              aria-label={`${tl("libraryActions")}: ${libraryName(entry)}`}
              title={tl("libraryActions")}
              onClick={() => { setSheet(null); openLibraryDialog(entry); }}
              className={cx(
                "grid h-9 w-9 flex-none cursor-pointer place-items-center rounded-full text-[var(--muted)] transition hover:bg-[var(--wash)] hover:text-[var(--ink)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25",
                !active && "lg:opacity-0 lg:group-hover:opacity-100",
              )}
            >
              <SlidersIcon className="h-4 w-4" />
            </button>
          </div>
        );
      })}
      {canManage ? (
        <button type="button" onClick={() => { setSheet(null); setDialog("new"); }} className="min-h-11 cursor-pointer pl-4 text-left text-[15px] text-[var(--muted)] transition hover:text-[var(--ink)] lg:min-h-9 lg:text-sm">
          ＋ {tl("addLibrary")}
        </button>
      ) : null}
    </div>
  );

  const facetHeading = "mb-1 text-xs text-[var(--muted)]";
  const facets = (
    <div className="flex flex-col gap-7">
      {genreNames.length > 1 ? (
        <div>
          <p className={facetHeading}>{t("group.genre")}</p>
          {genreNames.map((genre) => {
            const on = activeGenres.includes(genre);
            return <IndexRow key={genre} box label={genre} on={on} count={scoped.filter((item) => item.mainGenre?.trim() === genre).length} onClick={() => setGenres(on ? activeGenres.filter((entry) => entry !== genre) : [...activeGenres, genre])} />;
          })}
        </div>
      ) : null}
      {recommendationsEnabled && recommenders.length ? (
        <div>
          <p className={facetHeading}>{t("recommenderHeading")}</p>
          {[...recommenders, ["none", t("recommenderNone")] as [string, string]].map(([key, name]) => (
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
    <main className="px-4 py-8 pb-24 sm:px-6 sm:py-12 lg:px-20">
      <BackButton onClick={onBack} label={backLabel} className="mb-6" />

      {/* A computer reads the page's name as its title; a phone keeps it small above the library switcher. */}
      <h1 className="text-xs text-[var(--muted)] lg:mb-8 lg:text-4xl lg:font-medium lg:tracking-[-0.045em] lg:text-[var(--ink)]">{title}</h1>
      {subtitle ? <p className="mt-2 hidden max-w-2xl text-sm leading-6 text-[var(--muted)] lg:block">{subtitle}</p> : null}

      <StatusMessage error={librariesError ?? itemsError} success={notice} />

      {loading ? (
        <p className="mt-6 text-sm text-[var(--muted)]">{t("loading")}</p>
      ) : !tabs.length ? (
        <EmptyState
          title={t("emptyTitle")}
          action={canManage ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setDialog("add")}>＋ {t("addItem")}</Button>
              <Button variant="secondary" onClick={() => setDialog("new")}>{tl("newLibrary")}</Button>
            </div>
          ) : undefined}
        />
      ) : library ? (
        <div className="lg:flex lg:items-start lg:gap-14">
          <aside className="hidden w-56 flex-none lg:flex lg:flex-col lg:gap-7" aria-label={tl("tabsLabel")}>
            <div>
              <p className={facetHeading}>{tl("tabsLabel")}</p>
              {libraryIndex}
            </div>
            {scoped.length ? facets : null}
          </aside>

          <section className="min-w-0 flex-1" aria-label={libraryName(library)}>
            <button
              type="button"
              onClick={() => setSheet("libraries")}
              aria-haspopup="dialog"
              aria-label={`${t("chooseLibrary")}: ${libraryName(library)}`}
              className="mt-0.5 inline-flex min-h-11 max-w-full cursor-pointer items-center gap-2 text-3xl font-medium tracking-[-0.045em] lg:hidden"
            >
              <span className="truncate">{libraryName(library)}</span>
              <svg viewBox="0 0 16 16" className="h-4 w-4 flex-none text-[var(--muted)]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
            </button>

            {/* Search takes the row; Sort, Select and ＋ Item sit together at its end (on a phone, the row below it, with Filter). */}
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-3 lg:mt-0">
              <label className="flex h-11 min-w-0 basis-full items-center gap-2.5 border-b border-[var(--line)] transition focus-within:border-[var(--main)] sm:basis-0 sm:flex-1">
                <SearchIcon />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("searchPlaceholder", { name: libraryName(library) })}
                  aria-label={t("searchPlaceholder", { name: libraryName(library) })}
                  className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[var(--muted)]"
                />
              </label>
              <div className="flex flex-1 flex-wrap items-center gap-2 sm:flex-none">
                {scoped.length ? (
                  <button type="button" onClick={() => setSheet("filters")} aria-label={t("filter")} title={t("filter")} className={cx(chipClass(activeChips.length > 0), "!px-2.5 lg:hidden")}>
                    <SlidersIcon className="h-4 w-4" />
                    {activeChips.length ? <span className="text-xs text-[var(--muted)]">{activeChips.length}</span> : null}
                  </button>
                ) : null}
                <span className="flex-1 sm:hidden" />
                {scoped.length ? <CompactSelect<Sort> label={t("sortLabel")} value={activeSort} onChange={setSort} options={sortOptions} /> : null}
                {canManage && scoped.length ? (
                  <button type="button" aria-pressed={selecting} onClick={() => (selecting ? stopSelecting() : setSelecting(true))} className={chipClass(selecting)}>
                    {selecting ? t("doneSelecting") : t("select")}
                  </button>
                ) : null}
                {canManage ? <Button className="!min-h-9 !rounded-full !px-3.5" onClick={() => { setNotice(null); setDialog("add"); }}>＋ {t("newItem")}</Button> : null}
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
              <div className="sticky top-16 z-10 mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-3 shadow-[var(--elevate-1)]" role="region" aria-label={t("selectionBar")}>
                <Button variant="secondary" className="!rounded-full" disabled={!sorted.length} onClick={() => togglePicked(sorted.map((item) => item.id), !allHerePicked)}>
                  {allHerePicked ? t("clearSelection") : t("selectAll", { count: sorted.length })}
                </Button>
                <strong className="text-sm font-medium">{t("pickedTally", { count: pickedHere.length })}</strong>
                <span className="flex-1" />
                <Button variant="danger" className="!rounded-full" disabled={!pickedHere.length} onClick={() => setConfirmingRemoval(true)}>{t("removePicked", { count: pickedHere.length })}</Button>
              </div>
            ) : null}

            <div className="mt-3">
              {!scoped.length ? (
                <EmptyState
                  title={tl("emptyLibrary", { name: libraryName(library) })}
                  onClick={canManage ? () => setDialog("add") : undefined}
                />
              ) : !sorted.length ? (
                <EmptyState title={t("noMatches")} action={<Button variant="secondary" onClick={() => { clearFilters(); setQuery(""); }}>{t("clearFilters")}</Button>} />
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
                      <ul className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
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
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {sheet === "libraries" ? (
        <BottomSheet title={tl("tabsLabel")} onClose={() => setSheet(null)}>{libraryIndex}</BottomSheet>
      ) : null}
      {sheet === "filters" ? (
        <BottomSheet title={t("filter")} onClose={() => setSheet(null)}>
          {facets}
          <div className="mt-7 flex gap-2">
            <Button variant="secondary" onClick={clearFilters}>{t("clearFilters")}</Button>
            <Button className="flex-1" onClick={() => setSheet(null)}>{t("showResults", { count: sorted.length })}</Button>
          </div>
        </BottomSheet>
      ) : null}

      {dialog === "add" ? (
        <AddCatalogItemDialog
          scope={scope}
          libraries={libraries ?? []}
          initialKind={kind}
          members={members}
          recommendationsEnabled={recommendationsEnabled}
          source={source}
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
          onDeleted={dialogLibrary.source !== "screens" && dialogLibrary.source !== "pages" ? (name) => {
            setDialog(null);
            if (dialogLibrary.kind === kind) { chooseLibrary(""); stopSelecting(); }
            setNotice(tl("deleted", { name }));
            reloadAll();
          } : undefined}
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
