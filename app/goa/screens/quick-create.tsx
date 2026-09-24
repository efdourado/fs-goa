"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useState } from "react";

import { RecipeIcon } from "../recipe-icons";
import type { ChallengeCreationInput, GroupSummary, Id } from "../types";
import { BackButton, Button, cardClass, cx, inputClass, PageHeading, StatusMessage } from "../ui";
import { useGoaFormat } from "../format";
import { canManage } from "../utils";

/**
 * The three recipes that need nothing set up first: Screens and Pages draw from their own always-there
 * library, and a habit has no catalogue at all. `custom` and `tables` both need a library picked or made
 * before a challenge can hold items — one more decision this flow is built to avoid.
 */
const SAFE_RECIPES = ["cinema", "bookshelf", "habit"] as const;
type SafeRecipe = (typeof SAFE_RECIPES)[number];
/** Screens and Pages need at least one item to open with; a habit has no catalogue to seed. */
const NEEDS_ITEM: Record<SafeRecipe, boolean> = { cinema: true, bookshelf: true, habit: false };

type Where = { kind: "personal" } | { kind: "group"; groupId: Id; name: string; participantIds: Id[] };

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

/**
 * A short, guided way to start a challenge — three questions, every answer a tap (a title and, for a new
 * group, its name are the only typing). The fast path with no way to end up somewhere half-configured, for
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
  const f = useGoaFormat();
  const standardGroups = groups.filter((group) => group.kind !== "personal" && canManage(group.role));
  const presetWhere = (): Where | null => {
    if (into === "personal") return { kind: "personal" };
    const target = into ? standardGroups.find((group) => group.id === into.groupId) : null;
    return target ? { kind: "group", groupId: target.id, name: target.name, participantIds: target.members?.map((member) => member.id) ?? [currentUserId] } : null;
  };
  const [recipe, setRecipe] = useState<SafeRecipe | null>(null);
  const [where, setWhere] = useState<Where | null>(presetWhere);
  const [pickingNewGroup, setPickingNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [itemTitle, setItemTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetFrom(step: "recipe" | "where" | "title") {
    if (step === "recipe") setRecipe(null);
    // Changing the recipe keeps a destination the chat was opened into; changing the destination itself clears it.
    if (step !== "title") { setWhere(step === "recipe" ? presetWhere() : null); setPickingNewGroup(false); setNewGroupName(""); setGroupError(null); }
    setTitle(null);
    setTitleDraft("");
    setItemTitle("");
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

  async function create(name: string, firstItem: string) {
    if (!recipe || !where) return;
    setBusy(true);
    setError(null);
    try {
      const input: ChallengeCreationInput = {
        recipe,
        title: name,
        description: "",
        ruleSections: [],
        startsOn: null,
        endsOn: null,
        fields: [],
        items: firstItem ? [{ title: firstItem, position: 0 }] : [],
        generateDaily: false,
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
    if (title === null || !name) return;
    void create(title, name);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <BackButton onClick={onBack} label={backLabel ?? tc("back")} className="mb-6" />
      <PageHeading title={t("title")} description={t("subtitle")} />

      <div className="space-y-6">
        <div className="space-y-3">
          <Ask>{t("q1")}</Ask>
          {recipe ? (
            <Answered onEdit={() => resetFrom("recipe")} editLabel={t("change")}>{tr(`recipes.${recipe}.name`)}</Answered>
          ) : (
            <div className="ml-10 grid gap-3 sm:grid-cols-3">
              {SAFE_RECIPES.map((key) => (
                <OptionCard
                  key={key}
                  onClick={() => setRecipe(key)}
                  icon={<RecipeIcon name={key} className="h-[18px] w-[18px]" />}
                  title={tr(`recipes.${key}.name`)}
                  hint={tr(`recipes.${key}.tagline`)}
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

        {recipe && where ? (
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

        {recipe && where && title !== null && NEEDS_ITEM[recipe] ? (
          <div className="space-y-3">
            <Ask>{t(recipe === "cinema" ? "q4Cinema" : "q4Bookshelf")}</Ask>
            <form onSubmit={submitItem} className="ml-10 flex flex-wrap items-center gap-2.5">
              <input
                className={cx(inputClass, "max-w-sm flex-1")}
                value={itemTitle}
                onChange={(event) => setItemTitle(event.target.value)}
                placeholder={t(recipe === "cinema" ? "itemPlaceholderCinema" : "itemPlaceholderBookshelf")}
                maxLength={300}
                disabled={busy}
              />
              <Button type="submit" disabled={busy || !itemTitle.trim()}>{busy ? tc("saving") : t("create")}</Button>
            </form>
            {error ? <div className="ml-10"><StatusMessage error={error} /></div> : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}
