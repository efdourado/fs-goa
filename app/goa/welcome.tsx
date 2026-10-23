"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import { Dialog } from "./dialog";
import { useGoaFormat } from "./format";
import type { GroupSummary, Id } from "./types";
import { ArrowField, cx } from "./ui";

type Target = { personal: true } | { groupId: Id } | { newGroup: string };

/**
 * The round action beside a brand-new account's greeting. It asks how to begin (guided chat or by hand) and,
 * by hand, who it's for, so a group challenge never has to be started over.
 */
export function WelcomePanel({
  groups,
  onQuickCreate,
  onCreateManually,
}: {
  /** The groups this person can create challenges in. */
  groups: GroupSummary[];
  /** The guided, tap-only way to a first challenge (it asks who it's for itself). */
  onQuickCreate: () => void;
  /** The full creator, step by step, for the chosen target; a new group is made first. */
  onCreateManually: (target: Target) => Promise<void>;
}) {
  const t = useTranslations("welcome");
  const tq = useTranslations("quickCreate");
  const f = useGoaFormat();
  const [step, setStep] = useState<"how" | "where" | null>(null);
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const option = "flex w-full cursor-pointer flex-col items-start gap-1 rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25 disabled:cursor-not-allowed disabled:opacity-60";

  async function go(target: Target) {
    setBusy(true);
    setError(null);
    try {
      await onCreateManually(target);
      setStep(null);
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  function createGroup(event: FormEvent) {
    event.preventDefault();
    const name = groupName.trim();
    if (name) void go({ newGroup: name });
  }

  return (
    <>
      <div className="flex flex-none items-center">
        <button
          type="button"
          onClick={() => setStep("how")}
          aria-label={t("starts.quick.cta")}
          title={t("starts.quick.cta")}
          className="grid h-11 w-11 flex-none cursor-pointer place-items-center rounded-full bg-[var(--main)] text-white shadow-[var(--elevate-1)] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
      </div>

      {step ? (
        <Dialog title={step === "how" ? t("choose.title") : t("choose.whereTitle")} onClose={() => { setStep(null); setError(null); }} busy={busy}>
          {step === "how" ? (
            <div className="space-y-2.5 text-left">
              <button type="button" onClick={() => { setStep(null); onQuickCreate(); }} className={cx(option, "border-[var(--main)] bg-[var(--main-soft)]")}>
                <span className="flex w-full items-center justify-between gap-3">
                  <strong className="text-base font-medium text-[var(--main-strong)]">{t("choose.chat")}</strong>
                  <span className="rounded-full bg-[var(--main)] px-2.5 py-0.5 text-[11px] font-medium text-white">{t("choose.recommended")}</span>
                </span>
                <span className="text-sm leading-6 text-[var(--muted)]">{t("choose.chatBody")}</span>
              </button>
              <button type="button" onClick={() => setStep("where")} className={cx(option, "border-[var(--line)] hover:border-[var(--muted)]")}>
                <strong className="text-base font-medium">{t("choose.manual")}</strong>
                <span className="text-sm leading-6 text-[var(--muted)]">{t("choose.manualBody")}</span>
              </button>
            </div>
          ) : (
            <div className="space-y-2.5 text-left">
              <button type="button" disabled={busy} onClick={() => void go({ personal: true })} className={cx(option, "border-[var(--line)] hover:border-[var(--muted)]")}>
                <strong className="text-base font-medium">{tq("justMe")}</strong>
                <span className="text-sm leading-6 text-[var(--muted)]">{tq("justMeHint")}</span>
              </button>
              {groups.map((group) => (
                <button key={group.id} type="button" disabled={busy} onClick={() => void go({ groupId: group.id })} className={cx(option, "border-[var(--line)] hover:border-[var(--muted)]")}>
                  <strong className="text-base font-medium">{group.name}</strong>
                  <span className="text-sm leading-6 text-[var(--muted)]">{tq("groupHint", { count: group.members?.length ?? 1 })}</span>
                </button>
              ))}
              <form onSubmit={createGroup} className="rounded-2xl border border-dashed border-[var(--line)] p-4">
                <strong className="block text-base font-medium">{t("choose.newGroupTitle")}</strong>
                {/* The same pill as "invite by @username": type the name, the arrow makes the group and goes on. */}
                <ArrowField className="mt-3" value={groupName} onChange={setGroupName} maxLength={80} placeholder={tq("newGroupPlaceholder")} label={tq("newGroupPlaceholder")} submitLabel={t("choose.createAndGo")} disabled={busy} />
              </form>
              {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
            </div>
          )}
        </Dialog>
      ) : null}
    </>
  );
}
