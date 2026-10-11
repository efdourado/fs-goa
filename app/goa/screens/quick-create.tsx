"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useState } from "react";

import { API_PATHS, apiRequest } from "../api";
import { useCsrf } from "../csrf";
import { sessionPresetFields } from "../fields";
import { useGoaFormat } from "../format";
import { type CatalogScope, useCatalogLibraries, useLibraryName } from "../libraries";
import { RecipeIcon, type RecipeIconName } from "../recipe-icons";
import type { CatalogLibrary, ChallengeCreationInput, ChallengeField, CreatableRecipeKey, GroupSummary, Id } from "../types";
import { BackButton, Button, cardClass, cx, inputClass, PageHeading, StatusMessage } from "../ui";
import { canManage } from "../utils";

/**
 * What the chat can start, each a preset of the app's general capabilities:
 *  · Screens / Pages — rate films or books, from their always-there library;
 *  · the reading club — pages a day toward each book's end;
 *  · a habit — a check-in a day, or a number counted toward a goal;
 *  · a workout — one check-in holding a record per exercise, from a library of the person's own.
 * Tables and a fully custom challenge still need the wizard (several ratings, your own fields).
 */
const KINDS = ["cinema", "bookshelf", "library", "habit", "workout"] as const;
type Kind = (typeof KINDS)[number];
const RECIPE_OF: Record<Kind, CreatableRecipeKey> = { cinema: "cinema", bookshelf: "bookshelf", library: "library", habit: "habit", workout: "custom" };
const ICON_OF: Record<Kind, RecipeIconName> = { cinema: "cinema", bookshelf: "bookshelf", library: "library", habit: "habit", workout: "custom" };
/** Everything but a habit opens with a first item. */
const NEEDS_ITEM: Record<Kind, boolean> = { cinema: true, bookshelf: true, library: true, habit: false, workout: true };
/** A book is known by its title and author — the catalogue asks for both. */
const IS_BOOK: Record<Kind, boolean> = { cinema: false, bookshelf: true, library: true, habit: false, workout: false };

type Where = { kind: "personal" } | { kind: "group"; groupId: Id; name: string; participantIds: Id[] };
/** How a group's ratings come out: sealed until revealed, sealed with a guess first, or live. */
const RATING_MODES = ["reveal", "guess", "open"] as const;
type RatingMode = (typeof RATING_MODES)[number];
const MODE_KEY: Record<RatingMode, string> = { reveal: "modeReveal", guess: "modeGuess", open: "modeOpen" };
/** A habit: just "did it today", or a number counted along a road (toward a goal, when it has one). */
type HabitShape = { kind: "check" } | { kind: "count"; label: string; goal: number | null };
/** A workout's exercises live in a library of the person's own: one they already have, or a new one they name. */
type LibraryPick = { id: Id; name: string };

/** goa's own turn in the exchange — a small mark, then the question, in a quiet bubble. */
function Ask({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 grid h-7 w-7 flex-none -rotate-3 place-items-center rounded-[50%_50%_50%_16%] bg-[var(--ink)] text-xs font-black text-[var(--canvas)]" aria-hidden="true">g</span>
      <p className="mt-0.5 text-[15px] leading-6">{children}</p>
    </div>
  );
}

/** The person's turn: what they picked, once picked — with a quiet way to change their mind. */
function Answered({ children, onEdit, editLabel }: { children: ReactNode; onEdit: () => void; editLabel: string }) {
  return (
    <div className="ml-10 flex items-center gap-2.5">
      <span className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--main)] bg-[var(--main-soft)] px-4 text-sm font-medium text-[var(--main-strong)]">{children}</span>
      <button type="button" onClick={onEdit} className="cursor-pointer text-xs text-[var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--ink)]">{editLabel}</button>
    </div>
  );
}

/** One big tappable option — a recipe, a group, "just me" — picking it answers the question immediately. */
function OptionCard({ onClick, icon, title, hint }: { onClick: () => void; icon?: ReactNode; title: string; hint?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(cardClass, "flex cursor-pointer flex-col gap-1.5 p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--main-line)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25")}
    >
      {icon ? <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--main-soft)] text-[var(--main-strong)]" aria-hidden="true">{icon}</span> : null}
      <strong className="text-[15px] font-medium tracking-[-0.01em]">{title}</strong>
      {hint ? <span className="text-xs leading-5 text-[var(--muted)]">{hint}</span> : null}
    </button>
  );
}

/** The workout's library: the space's own lists to pick from, or a new one named here (never made on its own). */
function LibraryStep({ scope, onPick }: { scope: CatalogScope; onPick: (library: LibraryPick) => void }) {
  const t = useTranslations("quickCreate");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const csrf = useCsrf();
  const libraryName = useLibraryName();
  const { data } = useCatalogLibraries(scope);
  const own = (data ?? []).filter((library) => library.source === "custom");
  const [name, setName] = useState(t("libraryDefault"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function make(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = name.trim();
    if (!label) return;
    setBusy(true);
    setError(null);
    try {
      const made = await apiRequest<CatalogLibrary>(API_PATHS.catalogWorkspace(scope).libraries, { method: "POST", body: { label }, csrfToken: csrf });
      onPick({ id: made.id, name: label });
    } catch (cause) {
      setError(f.error(cause));
      setBusy(false);
    }
  }

  return (
    <div className="ml-10 space-y-3">
      {own.length ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {own.map((library) => <OptionCard key={library.id} onClick={() => onPick({ id: library.id, name: libraryName(library) })} title={libraryName(library)} />)}
        </div>
      ) : null}
      <form onSubmit={make} className="flex flex-wrap items-center gap-2.5">
        <input className={cx(inputClass, "max-w-xs flex-1")} value={name} onChange={(event) => setName(event.target.value)} aria-label={t("libraryNew")} placeholder={t("libraryDefault")} maxLength={80} disabled={busy} />
        <Button type="submit" disabled={busy || !name.trim()}>{busy ? tc("saving") : t("libraryNew")}</Button>
      </form>
      {error ? <StatusMessage error={error} /> : null}
    </div>
  );
}

/**
 * A short, guided way to start a challenge — a few questions, nearly every answer a tap (a title, a first
 * item and a new group's or list's name are the only typing). The fast path with no way to end up somewhere half-configured, for
 * a first challenge or the fifth — not a replacement for the full wizard, which is always still one tap
 * away from wherever this lands.
 */
export function QuickCreateScreen({
  currentUserId,
  groups,
  into,
  onBack,
  backLabel,
  onCreateGroup,
  onSubmit,
}: {
  currentUserId: Id;
  groups: GroupSummary[];
  /** Started from a group page or My space: that answers "where" before it is asked. */
  into?: { groupId: Id } | "personal";
  onBack: () => void;
  backLabel?: string;
  /** Makes the group and hands back its id — does not navigate anywhere on its own. */
  onCreateGroup: (name: string) => Promise<Id | null>;
  onSubmit: (target: { groupId: Id } | { personal: true }, input: ChallengeCreationInput) => Promise<void>;
}) {
  const t = useTranslations("quickCreate");
  const tr = useTranslations("createChallenge");
  const tc = useTranslations("common");
  const tp = useTranslations("fields.preset");
  const f = useGoaFormat();
  const standardGroups = groups.filter((group) => group.kind !== "personal" && canManage(group.role));
  const presetWhere = (): Where | null => {
    if (into === "personal") return { kind: "personal" };
    const target = into ? standardGroups.find((group) => group.id === into.groupId) : null;
    return target ? { kind: "group", groupId: target.id, name: target.name, participantIds: target.members?.map((member) => member.id) ?? [currentUserId] } : null;
  };
  const [recipe, setRecipe] = useState<Kind | null>(null);
  const [habit, setHabit] = useState<HabitShape | null>(null);
  const [countingHabit, setCountingHabit] = useState(false);
  const [countLabel, setCountLabel] = useState("");
  const [countGoal, setCountGoal] = useState("");
  const [library, setLibrary] = useState<LibraryPick | null>(null);
  const [where, setWhere] = useState<Where | null>(presetWhere);
  const [pickingNewGroup, setPickingNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [mode, setMode] = useState<RatingMode | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [itemTitle, setItemTitle] = useState("");
  const [itemAuthor, setItemAuthor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only a group rating something together has a reveal to plan.
  const asksMode = Boolean((recipe === "cinema" || recipe === "bookshelf") && where?.kind === "group");
  // A habit says what a day's check-in is; a workout says which list its exercises come from.
  const asksHabit = recipe === "habit";
  const asksLibrary = recipe === "workout";
  const modeSettled = (!asksMode || mode !== null) && (!asksHabit || habit !== null) && (!asksLibrary || library !== null);

  function resetFrom(step: "recipe" | "where" | "mode" | "title") {
    if (step === "recipe") setRecipe(null);
    if (step !== "title") { setMode(null); setHabit(null); setCountingHabit(false); setCountLabel(""); setCountGoal(""); setLibrary(null); }
    // Changing the recipe keeps a destination the chat was opened into; changing the destination itself clears it.
    if (step === "recipe" || step === "where") { setWhere(step === "recipe" ? presetWhere() : null); setPickingNewGroup(false); setNewGroupName(""); setGroupError(null); }
    setTitle(null);
    setTitleDraft("");
    setItemTitle("");
    setItemAuthor("");
    setError(null);
  }

  async function makeGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    setGroupBusy(true);
    setGroupError(null);
    try {
      const groupId = await onCreateGroup(name);
      if (!groupId) throw new Error(t("groupWithoutId"));
      setWhere({ kind: "group", groupId, name, participantIds: [currentUserId] });
      setPickingNewGroup(false);
    } catch (cause) {
      setGroupError(f.error(cause));
    } finally {
      setGroupBusy(false);
    }
  }

  const isBook = recipe ? IS_BOOK[recipe] : false;

  function confirmCount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = countLabel.trim();
    const goal = Number(countGoal);
    if (!label) return;
    setHabit({ kind: "count", label, goal: countGoal.trim() && Number.isFinite(goal) && goal > 0 ? goal : null });
  }

  /** What the check-in asks, when the preset's own fields aren't it: a counted number, or a workout's weight and reps. */
  function fieldsFor(): ChallengeField[] {
    if (recipe === "workout") return sessionPresetFields((key) => tp(key));
    if (recipe === "habit" && habit?.kind === "count") {
      return [
        {
          key: "quantidade", label: habit.label, type: "number", required: true,
          config: { min: 0, count: { goal: habit.goal === null ? null : { value: habit.goal }, entry: "amount", showDates: true } },
        },
        { key: "nota_dia", label: tp("comoFoi"), type: "text", required: false, config: { multiline: true, maxLength: 500 } },
      ];
    }
    return [];
  }

  async function create(name: string, firstItem: string) {
    if (!recipe || !where) return;
    setBusy(true);
    setError(null);
    try {
      const input: ChallengeCreationInput = {
        recipe: RECIPE_OF[recipe],
        title: name,
        description: "",
        ruleSections: [],
        startsOn: null,
        endsOn: null,
        fields: fieldsFor(),
        ...(recipe === "workout" && library
          ? { libraries: [{ libraryId: library.id }], recordingMode: "session" as const, sessionName: t("workoutSession"), sessionNoteLabel: tp("comoFoi") }
          : {}),
        items: firstItem ? [{ title: firstItem, position: 0, ...(isBook ? { author: itemAuthor.trim() } : {}) }] : [],
        generateDaily: false,
        ...(asksMode && mode !== "open" ? { revealTogether: true } : {}),
        ...(asksMode && mode === "guess" ? { expectation: true } : {}),
        participantIds: where.kind === "personal" ? [] : where.participantIds,
      };
      await onSubmit(where.kind === "personal" ? { personal: true } : { groupId: where.groupId }, input);
    } catch (cause) {
      setError(f.error(cause));
      setBusy(false);
    }
  }

  function confirmTitle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = titleDraft.trim();
    if (!recipe || !name) return;
    if (NEEDS_ITEM[recipe]) setTitle(name);
    else void create(name, "");
  }

  function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = itemTitle.trim();
    if (title === null || !name || (isBook && !itemAuthor.trim())) return;
    void create(title, name);
  }

  const kindName = (key: Kind) => (key === "workout" ? t("workout") : tr(`recipes.${key}.name`));
  const scope: CatalogScope | null = where ? (where.kind === "personal" ? "personal" : { groupId: where.groupId }) : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <BackButton onClick={onBack} label={backLabel ?? tc("back")} className="mb-6" />
      <PageHeading title={t("title")} description={t("subtitle")} />

      <div className="space-y-6">
        <div className="space-y-3">
          <Ask>{t("q1")}</Ask>
          {recipe ? (
            <Answered onEdit={() => resetFrom("recipe")} editLabel={t("change")}>{kindName(recipe)}</Answered>
          ) : (
            <div className="ml-10 grid gap-3 sm:grid-cols-3">
              {KINDS.map((key) => (
                <OptionCard
                  key={key}
                  onClick={() => setRecipe(key)}
                  icon={<RecipeIcon name={ICON_OF[key]} className="h-[18px] w-[18px]" />}
                  title={kindName(key)}
                  hint={key === "workout" ? t("workoutHint") : tr(`recipes.${key}.tagline`)}
                />
              ))}
            </div>
          )}
        </div>

        {recipe ? (
          <div className="space-y-3">
            <Ask>{t("q2")}</Ask>
            {where ? (
              <Answered onEdit={() => resetFrom("where")} editLabel={t("change")}>
                {where.kind === "personal" ? t("justMe") : where.name}
              </Answered>
            ) : (
              <div className="ml-10 space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <OptionCard onClick={() => setWhere({ kind: "personal" })} title={t("justMe")} hint={t("justMeHint")} />
                  {standardGroups.map((group) => (
                    <OptionCard
                      key={group.id}
                      onClick={() => setWhere({ kind: "group", groupId: group.id, name: group.name, participantIds: group.members?.map((member) => member.id) ?? [currentUserId] })}
                      title={group.name}
                      hint={t("groupHint", { count: group.memberCount ?? group.members?.length ?? 1 })}
                    />
                  ))}
                  {!pickingNewGroup ? <OptionCard onClick={() => setPickingNewGroup(true)} title={t("newGroup")} hint={t("newGroupHint")} /> : null}
                </div>
                {pickingNewGroup ? (
                  <form onSubmit={makeGroup} className={cx(cardClass, "flex flex-wrap items-center gap-2.5 p-4")}>
                    <input
                      className={cx(inputClass, "max-w-xs flex-1")}
                      value={newGroupName}
                      onChange={(event) => setNewGroupName(event.target.value)}
                      placeholder={t("newGroupPlaceholder")}
                      maxLength={100}
                      disabled={groupBusy}
                    />
                    <Button type="submit" disabled={groupBusy || !newGroupName.trim()}>{groupBusy ? tc("saving") : t("newGroupCreate")}</Button>
                    <Button variant="ghost" disabled={groupBusy} onClick={() => { setPickingNewGroup(false); setNewGroupName(""); setGroupError(null); }}>{tc("cancel")}</Button>
                    {groupError ? <span className="w-full"><StatusMessage error={groupError} /></span> : null}
                  </form>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        {asksMode && where ? (
          <div className="space-y-3">
            <Ask>{t("q5")}</Ask>
            {mode ? (
              <Answered onEdit={() => resetFrom("mode")} editLabel={t("change")}>{t(MODE_KEY[mode])}</Answered>
            ) : (
              <div className="ml-10 grid gap-3 sm:grid-cols-3">
                {RATING_MODES.map((key) => (
                  <OptionCard key={key} onClick={() => setMode(key)} title={t(MODE_KEY[key])} hint={t(`${MODE_KEY[key]}Hint`)} />
                ))}
              </div>
            )}
          </div>
        ) : null}

        {asksHabit && where ? (
          <div className="space-y-3">
            <Ask>{t("qHabit")}</Ask>
            {habit ? (
              <Answered onEdit={() => resetFrom("mode")} editLabel={t("change")}>
                {habit.kind === "check" ? t("habitCheck") : habit.goal === null ? habit.label : t("habitCountAnswer", { label: habit.label, goal: habit.goal })}
              </Answered>
            ) : countingHabit ? (
              <form onSubmit={confirmCount} className="ml-10 flex flex-wrap items-center gap-2.5">
                <input className={cx(inputClass, "max-w-[12rem] flex-1")} value={countLabel} onChange={(event) => setCountLabel(event.target.value)} placeholder={t("countLabelPlaceholder")} aria-label={t("countLabel")} maxLength={60} />
                <input className={cx(inputClass, "max-w-[9rem] flex-1")} value={countGoal} onChange={(event) => setCountGoal(event.target.value)} placeholder={t("countGoalPlaceholder")} aria-label={t("countGoal")} type="number" inputMode="decimal" min="0" step="any" />
                <Button type="submit" disabled={!countLabel.trim()}>{tc("continue")}</Button>
              </form>
            ) : (
              <div className="ml-10 grid gap-3 sm:grid-cols-3">
                <OptionCard onClick={() => setHabit({ kind: "check" })} title={t("habitCheck")} hint={t("habitCheckHint")} />
                <OptionCard onClick={() => setCountingHabit(true)} title={t("habitCount")} hint={t("habitCountHint")} />
              </div>
            )}
          </div>
        ) : null}

        {asksLibrary && where && scope ? (
          <div className="space-y-3">
            <Ask>{t("qLibrary")}</Ask>
            {library ? (
              <Answered onEdit={() => resetFrom("mode")} editLabel={t("change")}>{library.name}</Answered>
            ) : (
              <LibraryStep scope={scope} onPick={setLibrary} />
            )}
          </div>
        ) : null}

        {recipe && where && modeSettled ? (
          <div className="space-y-3">
            <Ask>{t("q3")}</Ask>
            {title !== null ? (
              <Answered onEdit={() => resetFrom("title")} editLabel={t("change")}>{title}</Answered>
            ) : (
              <form onSubmit={confirmTitle} className="ml-10 flex flex-wrap items-center gap-2.5">
                <input
                  className={cx(inputClass, "max-w-sm flex-1")}
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  placeholder={t("titlePlaceholder")}
                  maxLength={160}
                  disabled={busy}
                />
                <Button type="submit" disabled={busy || !titleDraft.trim()}>
                  {recipe && NEEDS_ITEM[recipe] ? tc("continue") : busy ? tc("saving") : t("create")}
                </Button>
              </form>
            )}
            {title === null && error ? <div className="ml-10"><StatusMessage error={error} /></div> : null}
          </div>
        ) : null}

        {recipe && where && modeSettled && title !== null && NEEDS_ITEM[recipe] ? (
          <div className="space-y-3">
            <Ask>{t(recipe === "cinema" ? "q4Cinema" : recipe === "workout" ? "q4Workout" : "q4Bookshelf")}</Ask>
            <form onSubmit={submitItem} className="ml-10 flex flex-wrap items-center gap-2.5">
              <input
                className={cx(inputClass, "max-w-sm flex-1")}
                value={itemTitle}
                onChange={(event) => setItemTitle(event.target.value)}
                placeholder={t(recipe === "cinema" ? "itemPlaceholderCinema" : recipe === "workout" ? "itemPlaceholderWorkout" : "itemPlaceholderBookshelf")}
                aria-label={t(recipe === "cinema" ? "q4Cinema" : recipe === "workout" ? "q4Workout" : "q4Bookshelf")}
                maxLength={300}
                disabled={busy}
              />
              {isBook ? (
                <input
                  className={cx(inputClass, "max-w-xs flex-1")}
                  value={itemAuthor}
                  onChange={(event) => setItemAuthor(event.target.value)}
                  placeholder={t("authorPlaceholder")}
                  aria-label={t("authorLabel")}
                  maxLength={300}
                  disabled={busy}
                />
              ) : null}
              <Button type="submit" disabled={busy || !itemTitle.trim() || (isBook && !itemAuthor.trim())}>{busy ? tc("saving") : t("create")}</Button>
            </form>
            {error ? <div className="ml-10"><StatusMessage error={error} /></div> : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}
