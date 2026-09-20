"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { ActionMenu, ActionMenuItem } from "../action-menu";
import { API_PATHS, apiRequest } from "../api";
import { AddCatalogItemDialog } from "../catalog-item-dialogs";
import { CatalogRow, CatalogTile, type CatalogGroupBy, decadeOf, groupCatalogItems, LayoutToggle } from "../catalog-views";
import { useCsrf } from "../csrf";
import { ConfirmDialog } from "../dialog";
import { useGoaFormat } from "../format";
import { DeleteLibraryDialog, NewLibraryDialog, LibraryPropertiesDialog, RenameLibraryDialog } from "../library-dialogs";
import {
  type CatalogScope,
  LibraryGlyph,
  useCatalogLibraries,
  useLibraryName,
} from "../libraries";
import { useLibraryProperties } from "../property-inputs";
import { recommenderLine, useRecommenderSource } from "../recommender-picker";
import { Segmented } from "../Segmented";
import type { CatalogItem, CatalogLibrary, Id, Member } from "../types";
import { BackButton, Button, cardClass, cx, EmptyState, StatusMessage } from "../ui";
import { formatRuntime } from "../utils";

type Layout = "covers" | "list";
type Sort = "recent" | "title" | "rating" | "date";

const icon = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const GridIcon = () => <svg viewBox="0 0 16 16" className="h-4 w-4" {...icon}><rect x="2" y="2" width="5" height="5" rx="1.2" /><rect x="9" y="2" width="5" height="5" rx="1.2" /><rect x="2" y="9" width="5" height="5" rx="1.2" /><rect x="9" y="9" width="5" height="5" rx="1.2" /></svg>;
const ListIcon = () => <svg viewBox="0 0 16 16" className="h-4 w-4" {...icon}><path d="M3 4h10M3 8h10M3 12h10" /></svg>;
const SearchIcon = () => <svg viewBox="0 0 16 16" className="h-4 w-4 flex-none" {...icon}><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>;

/** Lower-cased, accent-free, for matching what someone typed against a title. */
const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** A native select dressed as a chip; it lights up once it narrows the list. */
function ChipSelect({ label, value, onChange, active, children }: { label: string; value: string; onChange: (value: string) => void; active: boolean; children: ReactNode }) {
  return (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cx(
          "min-h-10 max-w-48 cursor-pointer rounded-full border px-4 text-sm outline-none transition focus-visible:ring-4 focus-visible:ring-[var(--main)]/25",
          active ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)] bg-[var(--paper)] text-[var(--ink)] hover:border-[var(--main-line)]",
        )}
      >
        {children}
      </select>
    </label>
  );
}

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
  subtitle: string;
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
  const [sort, setSort] = useState<Sort>("recent");
  const [search, setSearch] = useState("");
  const [genreFilter, setGenreFilter] = useState("");
  const [decadeFilter, setDecadeFilter] = useState("");
  const [recommenderFilter, setRecommenderFilter] = useState("");
  const [layout, setLayout] = useState<Layout>("covers");
  const [groupBy, setGroupBy] = useState<CatalogGroupBy>("none");
  const [dialog, setDialog] = useState<"add" | "new" | "rename" | "delete" | "properties" | null>(null);
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
  const scoped = useMemo(() => (items ?? []).filter((item) => item.kind === kind), [items, kind]);
  const isBuiltIn = kind === "film" || kind === "book";
  const loading = items === null || libraries === null;
  // A property someone hid stops showing on lists too — the values stay saved.
  const { properties: libraryProperties } = useLibraryProperties(library ? { id: library.id, kind: library.kind } : null, itemsNonce);
  const hidden = useMemo(() => new Set((libraryProperties ?? []).filter((property) => property.hidden).map((property) => property.key)), [libraryProperties]);

  function chooseLibrary(next: string) {
    setActiveKind(next);
    setSearch(""); setGenreFilter(""); setDecadeFilter(""); setRecommenderFilter("");
    setGroupBy("none");
    setUnusedOnly(false);
  }

  // Who brought things into this library, for the "recommended by" filter.
  const recommenders = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of scoped) if (item.recommendedBy) seen.set(`${item.recommendedBy.kind}:${item.recommendedBy.id}`, item.recommendedBy.name);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [scoped]);
  const genres = useMemo(() => [...new Set(scoped.map((item) => item.mainGenre?.trim()).filter((genre): genre is string => Boolean(genre)))].sort((a, b) => a.localeCompare(b)), [scoped]);
  const decades = useMemo(() => [...new Set(scoped.filter((item) => item.year).map((item) => decadeOf(item.year!)))].sort().reverse(), [scoped]);
  const activeFilter = recommenderFilter && (recommenderFilter === "none" || recommenders.some(([key]) => key === recommenderFilter)) ? recommenderFilter : "";
  const unusedCount = countByKind.get(kind ?? "")?.unused ?? 0;
  // Once the last unused item is gone the chip goes with it, so the filter can't be left stuck on.
  const onlyUnused = unusedOnly && unusedCount > 0;
  const query = fold(search.trim());
  const filtered = useMemo(() => scoped.filter((item) => {
    if (onlyUnused && (item.challengeCount ?? item.roundCount ?? 0) !== 0) return false;
    if (query && !fold([item.title, item.author, item.mainGenre, item.year].filter(Boolean).join(" ")).includes(query)) return false;
    if (genreFilter && (item.mainGenre?.trim() ?? "") !== genreFilter) return false;
    if (decadeFilter && !(item.year && decadeOf(item.year) === decadeFilter)) return false;
    if (!activeFilter) return true;
    if (activeFilter === "none") return !item.recommendedBy && !item.originNote;
    return item.recommendedBy ? `${item.recommendedBy.kind}:${item.recommendedBy.id}` === activeFilter : false;
  }), [scoped, activeFilter, onlyUnused, query, genreFilter, decadeFilter]);
  // Only offered where the library keeps an event date (a match's kickoff) on its items.
  const hasDates = scoped.some((item) => item.scheduledAt);
  const startOf = (item: CatalogItem) => (item.scheduledAt ? new Date(item.scheduledAt.startsAt).getTime() : Infinity);
  const addedAt = (item: CatalogItem) => (item.createdAt ? Date.parse(item.createdAt) : 0);
  const sorted = useMemo(() => [...filtered].sort((left, right) =>
    sort === "rating"
      ? (right.ratingAvg ?? -1) - (left.ratingAvg ?? -1) || left.title.localeCompare(right.title)
      : sort === "date" && hasDates
        ? startOf(left) - startOf(right) || left.title.localeCompare(right.title)
        : sort === "recent"
          ? addedAt(right) - addedAt(left) || left.title.localeCompare(right.title)
          : left.title.localeCompare(right.title),
  ), [filtered, sort, hasDates]);
  const groups = useMemo(() => groupCatalogItems(sorted, groupBy), [sorted, groupBy]);

  const rated = scoped.filter((item) => item.ratingAvg !== null && item.ratingAvg !== undefined);
  const average = rated.length ? Math.round((rated.reduce((sum, item) => sum + (item.ratingAvg ?? 0), 0) / rated.length) * 100) / 100 : null;

  /** What sets an item apart, minus the year (which the cover carries) and who recommended it. */
  function detailsFor(item: CatalogItem): string[] {
    const custom = (item.attributes ?? []).map((attribute) =>
      attribute.type === "boolean" ? `${attribute.label}: ${attribute.value ? tc("yes") : tc("no")}` : `${attribute.label}: ${String(attribute.value)}`);
    return [
      item.scheduledAt ? f.eventWhen(item.scheduledAt) : null,
      hidden.has("author") ? null : item.author,
      hidden.has("main_genre") ? null : item.mainGenre,
      hidden.has("runtime_minutes") ? null : formatRuntime(item.runtimeMinutes),
      ...custom,
    ].filter((part): part is string => Boolean(part));
  }
  const challengesOf = (item: CatalogItem) => item.challengeCount ?? item.roundCount ?? 0;
  const ratingLabel = (item: CatalogItem) => (item.ratingAvg === null || item.ratingAvg === undefined ? tItem("notRated") : tItem("ratedAria", { value: item.ratingAvg }));
  const yearOf = (item: CatalogItem) => (hidden.has("year") ? null : item.year);
  function metaFor(item: CatalogItem): string {
    return [
      ...detailsFor(item),
      recommendationsEnabled ? recommenderLine(item.recommendedBy, item.originNote, (name) => t("recommendedBy", { name }), (text) => t("origin", { text })) : null,
      isUnused(item) ? t("notInChallenge") : t("rounds", { count: challengesOf(item) }),
    ].filter(Boolean).join(" · ");
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

  const groupLabel = (label: string) => label || (groupBy === "genre" ? t("noGenre") : t("undated"));
  const narrowed = Boolean(query || genreFilter || decadeFilter || activeFilter || onlyUnused);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <BackButton onClick={onBack} label={backLabel} className="mb-6" />

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-medium tracking-[-0.045em] sm:text-4xl">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">{subtitle}</p>
        </div>
        {canManage ? (
          <div className="flex flex-none items-center gap-2">
            <Button onClick={() => { setNotice(null); setDialog("add"); }}>＋ {t("addItem")}</Button>
          </div>
        ) : null}
      </div>

      <StatusMessage error={librariesError ?? itemsError} success={notice} />

      {!loading && tabs.length ? (
        <nav className="-mx-4 mb-7 flex gap-3 overflow-x-auto px-4 pb-2 pt-1 sm:-mx-6 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label={tl("tabsLabel")}>
          {tabs.map((entry) => {
            const active = entry.kind === kind;
            const counts = countByKind.get(entry.kind) ?? { total: 0, unused: 0 };
            return (
              <button
                key={entry.id}
                type="button"
                aria-pressed={active}
                onClick={() => chooseLibrary(entry.kind)}
                className={cx(
                  "flex min-h-[4.75rem] w-64 flex-none cursor-pointer items-center gap-3.5 rounded-[20px] border px-4 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25",
                  active ? "border-[var(--main)] bg-[var(--main-soft)] ring-4 ring-[var(--main)]/10" : "border-[var(--line)] bg-[var(--paper)] hover:border-[var(--main-line)]",
                )}
              >
                <span className={cx("grid h-11 w-11 flex-none place-items-center rounded-full", active ? "bg-[var(--paper)] text-[var(--main-strong)]" : "bg-[var(--wash)] text-[var(--muted)]")} aria-hidden="true">
                  <LibraryGlyph source={entry.source} className="h-6 w-6" />
                </span>
                <span className="min-w-0">
                  <strong className={cx("block truncate text-base font-medium tracking-[-0.02em]", active && "text-[var(--main-strong)]")}>{libraryName(entry)}</strong>
                  <small className={cx("mt-0.5 block truncate text-xs", active ? "text-[var(--main-strong)]/85" : "text-[var(--muted)]")}>
                    {t("libraryStats", { count: counts.total })}{canManage && counts.unused > 0 ? ` · ${t("libraryUnused", { count: counts.unused })}` : ""}
                  </small>
                </span>
              </button>
            );
          })}
          {canManage ? (
            <button
              type="button"
              onClick={() => setDialog("new")}
              className="flex min-h-[4.75rem] flex-none cursor-pointer items-center justify-center gap-2 rounded-[20px] border border-dashed border-[var(--main-line)] px-6 text-sm font-light text-[var(--muted)] transition hover:text-[var(--ink)]"
            >
              ＋ {tl("newLibrary")}
            </button>
          ) : null}
        </nav>
      ) : null}

      {loading ? (
        <p className="text-sm text-[var(--muted)]">{t("loading")}</p>
      ) : !tabs.length ? (
        <EmptyState
          title={t("emptyTitle")}
          hint={canManage ? t("emptyHint") : undefined}
          action={canManage ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setDialog("add")}>＋ {t("addItem")}</Button>
              <Button variant="secondary" onClick={() => setDialog("new")}>{tl("newLibrary")}</Button>
            </div>
          ) : undefined}
        />
      ) : library ? (
        <section aria-label={libraryName(library)}>
          <div className="flex flex-wrap items-center gap-2.5">
            {scoped.length ? (
              <label className="flex min-h-11 min-w-0 basis-full items-center gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3.5 text-[var(--muted)] focus-within:border-[var(--main)] focus-within:ring-4 focus-within:ring-[var(--main)]/18 sm:basis-72">
                <SearchIcon />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("searchPlaceholder", { name: libraryName(library) })}
                  aria-label={t("searchLabel")}
                  className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
                />
              </label>
            ) : null}
            {genres.length > 1 ? (
              <ChipSelect label={t("genreFilterLabel")} value={genreFilter} onChange={setGenreFilter} active={Boolean(genreFilter)}>
                <option value="">{t("genreAll")}</option>
                {genres.map((genre) => <option key={genre} value={genre}>{genre}</option>)}
              </ChipSelect>
            ) : null}
            {decades.length > 1 ? (
              <ChipSelect label={t("decadeFilterLabel")} value={decadeFilter} onChange={setDecadeFilter} active={Boolean(decadeFilter)}>
                <option value="">{t("decadeAll")}</option>
                {decades.map((decade) => <option key={decade} value={decade}>{decade}</option>)}
              </ChipSelect>
            ) : null}
            {recommendationsEnabled && recommenders.length ? (
              <ChipSelect label={t("recommenderFilterLabel")} value={activeFilter} onChange={setRecommenderFilter} active={Boolean(activeFilter)}>
                <option value="">{t("recommenderAll")}</option>
                {recommenders.map(([key, name]) => <option key={key} value={key}>{t("recommendedBy", { name })}</option>)}
                <option value="none">{t("recommenderNone")}</option>
              </ChipSelect>
            ) : null}
            {canManage && unusedCount > 0 ? (
              <button
                type="button"
                aria-pressed={onlyUnused}
                onClick={() => { const next = !onlyUnused; setUnusedOnly(next); if (next) setSelecting(true); }}
                className={cx(
                  "min-h-10 cursor-pointer rounded-full border border-dashed px-4 text-sm transition",
                  onlyUnused ? "border-[var(--warn)] bg-[var(--warn-soft)] text-[var(--warn)]" : "border-[var(--warn-line)] bg-[var(--warn-soft)]/60 text-[var(--warn)] hover:bg-[var(--warn-soft)]",
                )}
              >
                {t("unusedFilter", { count: unusedCount })}
              </button>
            ) : null}
            <span className="flex-1" />
            {scoped.length ? (
              <ChipSelect label={t("sortLabel")} value={sort} onChange={(next) => setSort(next as Sort)} active={false}>
                <option value="recent">{t("sortRecent")}</option>
                <option value="title">{t("sortTitle")}</option>
                <option value="rating">{t("sortRating")}</option>
                {hasDates ? <option value="date">{t("sortDate")}</option> : null}
              </ChipSelect>
            ) : null}
            {scoped.length ? (
              <LayoutToggle<Layout>
                label={t("viewLabel")}
                value={layout}
                onChange={setLayout}
                options={[
                  { value: "covers", label: t("viewCovers"), icon: <GridIcon /> },
                  { value: "list", label: t("viewList"), icon: <ListIcon /> },
                ]}
              />
            ) : null}
            {canManage && scoped.length ? (
              <button
                type="button"
                aria-pressed={selecting}
                onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
                className={cx(
                  "min-h-10 cursor-pointer rounded-full border px-4 text-sm transition",
                  selecting ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)] bg-[var(--paper)] text-[var(--ink)] hover:border-[var(--main-line)]",
                )}
              >
                {selecting ? t("doneSelecting") : t("select")}
              </button>
            ) : null}
            <ActionMenu label={tl("libraryActions")} iconOnly>
              <ActionMenuItem onClick={() => setDialog("properties")}>{canManage ? tl("editProperties") : tl("viewProperties")}</ActionMenuItem>
              {canManage ? <ActionMenuItem onClick={() => setDialog("rename")}>{tl("renameLibrary")}</ActionMenuItem> : null}
              {canManage && library && library.source !== "screens" && library.source !== "pages" ? <ActionMenuItem onClick={() => setDialog("delete")}>{tl("deleteLibrary")}</ActionMenuItem> : null}
            </ActionMenu>
          </div>

          {scoped.length ? (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-[var(--muted)]" aria-live="polite">
                <strong className="font-medium text-[var(--ink)]">{narrowed ? t("resultOf", { shown: sorted.length, total: scoped.length }) : t("resultCount", { count: scoped.length })}</strong>
                {average !== null ? ` · ${t("averageRating", { value: average })}` : ""}
              </p>
              {isBuiltIn ? (
                <div className="flex items-center gap-2.5 text-xs text-[var(--muted)]">
                  {t("groupByLabel")}
                  <Segmented<CatalogGroupBy>
                    className="w-64"
                    ariaLabel={t("groupByLabel")}
                    value={groupBy}
                    onChange={setGroupBy}
                    options={[
                      { value: "none", label: t("group.none") },
                      { value: "genre", label: t("group.genre") },
                      { value: "decade", label: t("group.decade") },
                      { value: "year", label: t("group.year") },
                    ]}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {selecting ? (
            <div className="sticky top-16 z-10 mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--main-line)] bg-[var(--main-soft)] p-3 shadow-[var(--elevate-1)]" role="region" aria-label={t("selectionBar")}>
              <Button variant="secondary" disabled={!sorted.length} onClick={() => togglePicked(sorted.map((item) => item.id), !allHerePicked)}>
                {allHerePicked ? t("clearSelection") : t("selectAll", { count: sorted.length })}
              </Button>
              <strong className="text-sm font-medium">{t("pickedTally", { count: pickedHere.length })}</strong>
              <span className="flex-1" />
              <Button variant="danger" disabled={!pickedHere.length} onClick={() => setConfirmingRemoval(true)}>{t("removePicked", { count: pickedHere.length })}</Button>
            </div>
          ) : null}

          <div className="mt-5">
            {!scoped.length ? (
              <EmptyState
                title={tl("emptyLibrary", { name: libraryName(library) })}
                onClick={canManage ? () => setDialog("add") : undefined}
              />
            ) : !sorted.length ? (
              <EmptyState title={t("noMatches")} />
            ) : (
              <div className="space-y-10">
                {groups.map((group) => (
                  <section key={group.key} aria-label={groupBy === "none" ? undefined : groupLabel(group.label)}>
                    {groupBy !== "none" ? (
                      <h2 className="mb-4 flex items-baseline gap-2.5 text-lg font-light tracking-[-0.02em]">
                        {groupLabel(group.label)}
                        <span className="text-xs text-[var(--muted)]">{group.items.length}</span>
                      </h2>
                    ) : null}
                    {layout === "covers" ? (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4 xl:grid-cols-5">
                        {group.items.map((item) => {
                          const unused = isUnused(item);
                          return (
                            <CatalogTile
                              key={item.id}
                              title={item.title}
                              year={yearOf(item)}
                              avg={item.ratingAvg}
                              ratingLabel={ratingLabel(item)}
                              caption={detailsFor(item).slice(0, 2).join(" · ")}
                              note={unused ? t("notInChallenge") : t("rounds", { count: challengesOf(item) })}
                              noteTone={unused ? "warn" : "muted"}
                              selecting={selecting}
                              picked={picked.has(item.id)}
                              onPick={(on) => togglePicked([item.id], on)}
                              onOpen={() => onOpenItem(item.id)}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <ul className={cx(cardClass, "divide-y divide-[var(--line)] overflow-hidden")}>
                        {group.items.map((item) => (
                          <li key={item.id}>
                            <CatalogRow
                              title={item.title}
                              year={yearOf(item)}
                              avg={item.ratingAvg}
                              ratingLabel={ratingLabel(item)}
                              meta={metaFor(item)}
                              selecting={selecting}
                              picked={picked.has(item.id)}
                              onPick={(on) => togglePicked([item.id], on)}
                              onOpen={() => onOpenItem(item.id)}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ))}
              </div>
            )}
          </div>
        </section>
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
      {dialog === "rename" && library ? (
        <RenameLibraryDialog library={library} onCancel={() => setDialog(null)} onRenamed={() => { setDialog(null); reloadLibraries(); }} />
      ) : null}
      {dialog === "delete" && library ? (
        <DeleteLibraryDialog
          library={library}
          itemCount={scoped.length}
          onCancel={() => setDialog(null)}
          onDeleted={(name) => { setDialog(null); chooseLibrary(""); stopSelecting(); setNotice(tl("deleted", { name })); reloadAll(); }}
        />
      ) : null}
      {dialog === "properties" && library ? (
        <LibraryPropertiesDialog scope={scope} library={library} canEdit={canManage} onClose={() => setDialog(null)} onChanged={reloadAll} />
      ) : null}
      {confirmingRemoval ? (
        <ConfirmDialog
          title={t("removeManyTitle", { count: pickedHere.length })}
          body={t("removeManyBody")}
          confirmLabel={t("removeManyConfirm", { count: pickedHere.length })}
          busyLabel={tc("saving")}
          danger
          onClose={() => setConfirmingRemoval(false)}
          onConfirm={removePicked}
        />
      ) : null}
    </main>
  );
}
