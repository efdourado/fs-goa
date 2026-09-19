"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { ActionMenu, ActionMenuItem } from "../action-menu";
import { API_PATHS, apiRequest } from "../api";
import { byRatingDesc, bucketize, type CatalogBucket, decadeOf, highlights } from "../catalog-insights";
import { AddCatalogItemDialog } from "../catalog-item-dialogs";
import { useCsrf } from "../csrf";
import { ConfirmDialog } from "../dialog";
import { useGoaFormat } from "../format";
import { NewLibraryDialog, LibraryPropertiesDialog, RenameLibraryDialog } from "../library-dialogs";
import {
  type CatalogScope,
  LibraryGlyph,
  useCatalogLibraries,
  useLibraryName,
} from "../libraries";
import { useLibraryProperties } from "../property-inputs";
import { recommenderLine, useRecommenderSource } from "../recommender-picker";
import type { CatalogItem, CatalogLibrary, Id, Member } from "../types";
import { BackButton, Button, cardClass, cx, EmptyState, StatusMessage } from "../ui";
import { formatRuntime } from "../utils";

type View = "list" | "genre" | "year" | "decade";

/** Fixed 0–5 scale so a bar means the same thing across genre / year / decade. */
const RATING_MAX = 5;

function BucketBars({ buckets, emptyLabel }: { buckets: CatalogBucket[]; emptyLabel: string }) {
  const t = useTranslations("personalCatalog");
  const rows = byRatingDesc(buckets);
  return (
    <ul className={cx(cardClass, "divide-y divide-[var(--line)] overflow-hidden")}>
      {rows.map((bucket) => {
        const pct = bucket.ratingAvg === null ? 0 : Math.max(2, Math.min(100, (bucket.ratingAvg / RATING_MAX) * 100));
        return (
          <li key={bucket.key} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 px-5 py-3.5 sm:grid-cols-[9rem_1fr_auto]">
            <span className="truncate text-sm font-light" title={bucket.label || emptyLabel}>{bucket.label || emptyLabel}</span>
            <span className="h-2.5 rounded-full bg-[var(--wash)]" aria-hidden="true">
              <span className="block h-full rounded-full bg-[var(--main)]" style={{ width: `${pct}%` }} />
            </span>
            <span className="whitespace-nowrap text-right text-sm tabular-nums">
              {bucket.ratingAvg === null ? <span className="text-[var(--muted)]">—</span> : bucket.ratingAvg}
              <span className="ml-2 text-[10px] font-light text-[var(--muted)]">
                {t("bucketMeta", { ratings: bucket.ratingCount, items: bucket.itemCount })}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
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
  const tl = useTranslations("libraries");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const libraryName = useLibraryName();
  const { data: libraries, error: librariesError, reload: reloadLibraries } = useCatalogLibraries(scope);
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [itemsNonce, setItemsNonce] = useState(0);
  const [activeKind, setActiveKind] = useState<string | null>(null);
  const [sort, setSort] = useState<"title" | "rating" | "date">("title");
  const [recommenderFilter, setRecommenderFilter] = useState("");
  const [view, setView] = useState<View>("list");
  const [dialog, setDialog] = useState<"add" | "new" | "rename" | "properties" | null>(null);
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

  // Libraries a person can see as tabs: the real ones. A built-in (Screens/Pages) shows up once it has an item.
  const tabs: CatalogLibrary[] = useMemo(() => libraries ?? [], [libraries]);
  const countByKind = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items ?? []) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    return counts;
  }, [items]);
  const fallbackKind = tabs.length
    ? [...tabs].sort((a, b) => (countByKind.get(b.kind) ?? 0) - (countByKind.get(a.kind) ?? 0))[0].kind
    : null;
  const kind = activeKind && tabs.some((library) => library.kind === activeKind) ? activeKind : fallbackKind;
  const library = tabs.find((entry) => entry.kind === kind) ?? null;
  const scoped = useMemo(() => (items ?? []).filter((item) => item.kind === kind), [items, kind]);
  const isBuiltIn = kind === "film" || kind === "book";
  const loading = items === null || libraries === null;
  // A property someone hid stops showing on lists too — the values stay saved.
  const { properties: libraryProperties } = useLibraryProperties(library ? { id: library.id, kind: library.kind } : null, itemsNonce);
  const hidden = useMemo(() => new Set((libraryProperties ?? []).filter((property) => property.hidden).map((property) => property.key)), [libraryProperties]);

  // Who brought things into this library, for the "recommended by" filter.
  const recommenders = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of scoped) if (item.recommendedBy) seen.set(`${item.recommendedBy.kind}:${item.recommendedBy.id}`, item.recommendedBy.name);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [scoped]);
  const activeFilter = recommenderFilter && (recommenderFilter === "none" || recommenders.some(([key]) => key === recommenderFilter)) ? recommenderFilter : "";
  const isUnused = (item: CatalogItem) => (item.challengeCount ?? item.roundCount ?? 0) === 0;
  const unusedCount = useMemo(() => scoped.filter((item) => (item.challengeCount ?? item.roundCount ?? 0) === 0).length, [scoped]);
  // Once the last unused item is gone the chip goes with it, so the filter can't be left stuck on.
  const onlyUnused = unusedOnly && unusedCount > 0;
  const filtered = useMemo(() => scoped.filter((item) => {
    if (onlyUnused && (item.challengeCount ?? item.roundCount ?? 0) !== 0) return false;
    if (!activeFilter) return true;
    if (activeFilter === "none") return !item.recommendedBy && !item.originNote;
    return item.recommendedBy ? `${item.recommendedBy.kind}:${item.recommendedBy.id}` === activeFilter : false;
  }), [scoped, activeFilter, onlyUnused]);
  // Only offered where the library keeps an event date (a match's kickoff) on its items.
  const hasDates = scoped.some((item) => item.scheduledAt);
  const startOf = (item: CatalogItem) => (item.scheduledAt ? new Date(item.scheduledAt.startsAt).getTime() : Infinity);
  const sorted = useMemo(() => [...filtered].sort((left, right) =>
    sort === "rating"
      ? (right.ratingAvg ?? -1) - (left.ratingAvg ?? -1)
      : sort === "date" && hasDates
        ? startOf(left) - startOf(right) || left.title.localeCompare(right.title)
        : left.title.localeCompare(right.title),
  ), [filtered, sort, hasDates]);

  const genreBuckets = useMemo(
    () => bucketize(scoped, (item) => ({ key: (item.mainGenre ?? "").toLowerCase() || "__none__", label: item.mainGenre?.trim() ?? "" })),
    [scoped],
  );
  const yearBuckets = useMemo(
    () => bucketize(scoped, (item) => (item.year ? { key: String(item.year), label: String(item.year) } : null)),
    [scoped],
  );
  const decadeBuckets = useMemo(
    () => bucketize(scoped, (item) => (item.year ? { key: decadeOf(item.year), label: decadeOf(item.year) } : null)),
    [scoped],
  );
  const activeView: View = isBuiltIn ? view : "list";
  const activeBuckets = activeView === "genre" ? genreBuckets : activeView === "year" ? yearBuckets : activeView === "decade" ? decadeBuckets : [];
  const topGenres = useMemo(() => highlights(genreBuckets), [genreBuckets]);
  const topYears = useMemo(() => highlights(yearBuckets), [yearBuckets]);
  const views: View[] = ["list", "genre", "decade", "year"];
  const rated = scoped.filter((item) => item.ratingAvg !== null && item.ratingAvg !== undefined);
  const average = rated.length ? Math.round((rated.reduce((sum, item) => sum + (item.ratingAvg ?? 0), 0) / rated.length) * 100) / 100 : null;

  function metaFor(item: CatalogItem): string {
    const custom = (item.attributes ?? []).map((attribute) =>
      attribute.type === "boolean" ? `${attribute.label}: ${attribute.value ? tc("yes") : tc("no")}` : `${attribute.label}: ${String(attribute.value)}`);
    return [
      item.scheduledAt ? f.eventWhen(item.scheduledAt) : null,
      hidden.has("author") ? null : item.author,
      hidden.has("main_genre") ? null : item.mainGenre,
      hidden.has("runtime_minutes") ? null : formatRuntime(item.runtimeMinutes),
      ...custom,
      recommendationsEnabled ? recommenderLine(item.recommendedBy, item.originNote, (name) => t("recommendedBy", { name }), (text) => t("origin", { text })) : null,
      isUnused(item) ? t("notInChallenge") : t("rounds", { count: item.challengeCount ?? item.roundCount ?? 0 }),
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

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <BackButton onClick={onBack} label={backLabel} className="mb-6" />

      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
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
        <div className="mb-6 flex items-center gap-2">
          <nav className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label={tl("tabsLabel")}>
            {tabs.map((entry) => {
              const active = entry.kind === kind;
              return (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => { setActiveKind(entry.kind); setView("list"); }}
                  className={cx(
                    "inline-flex min-h-11 flex-none cursor-pointer items-center gap-2 rounded-full border px-4 text-sm transition",
                    active
                      ? "border-[var(--main)] bg-[var(--main-soft)] font-medium text-[var(--main-strong)] shadow-[var(--elevate-1)]"
                      : "border-[var(--line)] bg-[var(--paper)] text-[var(--muted)] hover:border-[var(--main-line)] hover:text-[var(--ink)]",
                  )}
                >
                  <LibraryGlyph source={entry.source} />
                  {libraryName(entry)}
                  <span className={cx("rounded-full px-2 py-0.5 text-[11px] tabular-nums", active ? "bg-[var(--main)]/12" : "bg-[var(--wash)]")}>{countByKind.get(entry.kind) ?? 0}</span>
                </button>
              );
            })}
          </nav>
          {canManage ? (
            <button
              type="button"
              onClick={() => setDialog("new")}
              className="inline-flex min-h-11 flex-none cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-[var(--line)] px-4 text-sm text-[var(--muted)] transition hover:border-[var(--main-line)] hover:text-[var(--ink)]"
            >
              ＋ {tl("newLibrary")}
            </button>
          ) : null}
        </div>
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
          <div className={cx(cardClass, "mb-5 flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4")}>
            <div className="flex min-w-0 flex-1 basis-52 items-center gap-4">
              <span className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-[var(--main-soft)] text-[var(--main-strong)]" aria-hidden="true">
                <LibraryGlyph source={library.source} className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-xl font-light tracking-[-0.02em]">{libraryName(library)}</h2>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {t("libraryStats", { count: scoped.length })}
                  {average !== null ? ` · ${t("averageRating", { value: average })}` : ""}
                </p>
              </div>
            </div>
            <div className="flex w-full flex-none flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              {canManage && unusedCount > 0 ? (
                <button
                  type="button"
                  aria-pressed={onlyUnused}
                  onClick={() => { const next = !onlyUnused; setUnusedOnly(next); if (next) setSelecting(true); }}
                  className={cx(
                    "min-h-10 cursor-pointer rounded-full border px-4 text-sm transition",
                    onlyUnused ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)] bg-[var(--paper)] text-[var(--ink)] hover:border-[var(--main-line)]",
                  )}
                >
                  {t("unusedFilter", { count: unusedCount })}
                </button>
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
              {recommendationsEnabled && recommenders.length ? (
                <label className="text-xs text-[var(--muted)]">
                  <span className="sr-only">{t("recommenderFilterLabel")}</span>
                  <select className="min-h-10 max-w-44 rounded-full border border-[var(--line)] bg-[var(--paper)] px-4 text-sm text-[var(--ink)]" value={activeFilter} onChange={(event) => setRecommenderFilter(event.target.value)}>
                    <option value="">{t("recommenderAll")}</option>
                    {recommenders.map(([key, name]) => <option key={key} value={key}>{t("recommendedBy", { name })}</option>)}
                    <option value="none">{t("recommenderNone")}</option>
                  </select>
                </label>
              ) : null}
              {scoped.length ? (
                <label className="text-xs text-[var(--muted)]">
                  <span className="sr-only">{t("sortLabel")}</span>
                  <select className="min-h-10 rounded-full border border-[var(--line)] bg-[var(--paper)] px-4 text-sm text-[var(--ink)]" value={sort} onChange={(event) => setSort(event.target.value as "title" | "rating" | "date")}>
                    <option value="title">{t("sortTitle")}</option>
                    <option value="rating">{t("sortRating")}</option>
                    {hasDates ? <option value="date">{t("sortDate")}</option> : null}
                  </select>
                </label>
              ) : null}
              <ActionMenu label={tl("libraryActions")} iconOnly>
                <ActionMenuItem onClick={() => setDialog("properties")}>{canManage ? tl("editProperties") : tl("viewProperties")}</ActionMenuItem>
                {canManage ? <ActionMenuItem onClick={() => setDialog("rename")}>{tl("renameLibrary")}</ActionMenuItem> : null}
              </ActionMenu>
            </div>
          </div>

          {isBuiltIn && scoped.length ? (
            <nav className="mb-4 flex w-fit gap-1 rounded-full bg-[var(--wash-strong)]/70 p-1 text-xs" aria-label={t("viewLabel")}>
              {views.map((option) => (
                <button
                  type="button"
                  key={option}
                  aria-pressed={view === option}
                  className={cx("min-h-9 rounded-full px-3 font-light", view === option ? "bg-[var(--paper)] text-[var(--main-strong)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]")}
                  onClick={() => setView(option)}
                >
                  {t(`view.${option}`)}
                </button>
              ))}
            </nav>
          ) : null}

          {selecting && activeView === "list" ? (
            <div className="sticky top-16 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--main-line)] bg-[var(--main-soft)] p-3 shadow-[var(--elevate-1)]" role="region" aria-label={t("selectionBar")}>
              <Button variant="secondary" disabled={!sorted.length} onClick={() => togglePicked(sorted.map((item) => item.id), !allHerePicked)}>
                {allHerePicked ? t("clearSelection") : t("selectAll", { count: sorted.length })}
              </Button>
              <strong className="text-sm font-medium">{t("pickedTally", { count: pickedHere.length })}</strong>
              <span className="flex-1" />
              <Button variant="danger" disabled={!pickedHere.length} onClick={() => setConfirmingRemoval(true)}>{t("removePicked", { count: pickedHere.length })}</Button>
            </div>
          ) : null}

          {!scoped.length ? (
            <EmptyState
              title={tl("emptyLibrary", { name: libraryName(library) })}
              onClick={canManage ? () => setDialog("add") : undefined}
            />
          ) : activeView === "list" && !sorted.length ? (
            <EmptyState title={t("noMatches")} />
          ) : activeView === "list" ? (
            <ul className={cx(cardClass, "divide-y divide-[var(--line)] overflow-hidden")}>
              {sorted.map((item) => {
                const body = (
                  <>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate font-light">{item.title}{item.year && !hidden.has("year") ? ` (${item.year})` : ""}</strong>
                      <small className="mt-1 block truncate text-[var(--muted)]">{metaFor(item)}</small>
                    </span>
                    <span className="flex-none text-sm tabular-nums">
                      {item.ratingAvg === null || item.ratingAvg === undefined ? <span className="text-[var(--muted)]">—</span> : `${item.ratingAvg} · n=${item.ratingCount ?? 0}`}
                    </span>
                  </>
                );
                return (
                  <li key={item.id}>
                    {selecting ? (
                      <label className="flex w-full cursor-pointer items-center gap-4 px-5 py-4 text-left transition hover:bg-[var(--wash)]">
                        <input type="checkbox" className="h-4 w-4 flex-none" checked={picked.has(item.id)} aria-label={item.title} onChange={(event) => togglePicked([item.id], event.target.checked)} />
                        {body}
                      </label>
                    ) : (
                      <button type="button" className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-[var(--wash)]" onClick={() => onOpenItem(item.id)}>{body}</button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : activeBuckets.length ? (
            <div className="space-y-4">
              {(activeView === "genre" ? topGenres : topYears).length ? (
                <p className="text-sm text-[var(--muted)]">
                  {t(activeView === "genre" ? "bestGenres" : "bestYears", {
                    list: (activeView === "genre" ? topGenres : topYears).map((bucket) => `${bucket.label || t("noGenre")} (${bucket.ratingAvg})`).join(", "),
                  })}
                </p>
              ) : null}
              <BucketBars buckets={activeBuckets} emptyLabel={t("noGenre")} />
            </div>
          ) : (
            <EmptyState title={t("bucketEmptyTitle")} />
          )}
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
          onCreated={(made) => { setDialog(null); setActiveKind(made.kind); setView("list"); reloadAll(); }}
        />
      ) : null}
      {dialog === "rename" && library ? (
        <RenameLibraryDialog library={library} onCancel={() => setDialog(null)} onRenamed={() => { setDialog(null); reloadLibraries(); }} />
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
