"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import { API_PATHS, apiRequest } from "../api";
import { SkippedPropertiesNotice } from "../copy-notice";
import { Dialog, ModalActions } from "../dialog";
import { useGoaFormat } from "../format";
import { SettingsMenu } from "../SettingsMenu";
import { PublishedTemplates } from "../template-gallery";
import type {
  ChallengeDetail,
  CopyResult,
  GroupSummary,
  Id,
  SkippedProperty,
  User,
} from "../types";
import { BackButton, Brand, Button, CircleMinusIcon, CirclePinIcon, cx, labelClass, PageHeading, Select, SelectableCards, StatusMessage } from "../ui";
import { ParticipantChallengeScreen } from "./participant-challenge";

function PublicChrome({ user, onSignIn, children }: { user: User | null; onSignIn: () => void; children: ReactNode }) {
  const t = useTranslations("templates");
  if (user) return <>{children}</>;
  return (
    <div className="flex min-h-screen flex-col bg-[var(--canvas)] text-[var(--ink)]">
      <header className="sticky top-0 z-30 border-b border-[var(--edge)] bg-[var(--canvas)]/92 backdrop-blur-xl">
        <div className="flex h-16 items-center justify-between px-4 sm:h-[76px] sm:px-6 lg:px-20">
          <Brand />
          <div className="flex items-center gap-2">
            <SettingsMenu />
            <Button variant="secondary" onClick={onSignIn}>{t("signIn")}</Button>
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function TemplatesScreen({
  user,
  onOpen,
  onBack,
  backLabel,
  onSignIn,
  onEmpty,
}: {
  user: User | null;
  onOpen: (challengeId: Id) => void;
  onBack: () => void;
  /** What the button says — the parent screen's name; falls back to plain "Back". */
  backLabel?: string;
  onSignIn: () => void;
  /** Signed out and nothing published — the front door has nothing to show, so the caller sends them to sign in. */
  onEmpty?: () => void;
}) {
  const t = useTranslations("templates");

  const body = (
    <main className="px-4 py-8 pb-24 sm:px-6 sm:py-12 lg:px-20">
      {user ? (
        <>
          <BackButton onClick={onBack} label={backLabel ?? t("back")} className="mb-6" />
          <PageHeading title={t("title")} />
        </>
      ) : (
        // Signed out, this is goa's front door: say what it is, then show real results; Sign in waits in the header.
        <header className="mb-10 max-w-3xl">
          <h1 className="text-3xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-4xl">{t("frontTitle")}</h1>
          <p className="mt-4 text-base leading-7 text-[var(--muted)]">{t("frontLede")}</p>
        </header>
      )}

      <PublishedTemplates onOpen={onOpen} onEmpty={onEmpty} />
    </main>
  );

  return <PublicChrome user={user} onSignIn={onSignIn}>{body}</PublicChrome>;
}

export function TemplateDetailScreen({
  user,
  challengeId,
  groups,
  onBack,
  backLabel,
  onSignIn,
  onDuplicated,
  onUnpublished,
  csrfToken,
  autoCopy = false,
}: {
  user: User | null;
  challengeId: Id;
  groups: GroupSummary[];
  onBack: () => void;
  /** What the button says — the parent screen's name; falls back to plain "Back". */
  backLabel?: string;
  onSignIn: () => void;
  onDuplicated: (result: { challengeId: Id }) => void;
  onUnpublished?: () => void;
  csrfToken: string;
  autoCopy?: boolean;
}) {
  const t = useTranslations("templates");
  const tm = useTranslations("managementUX");
  const f = useGoaFormat();
  const canPublish = Boolean(user?.platformAdmin);
  const [detail, setDetail] = useState<ChallengeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCopy, setShowCopy] = useState(Boolean(autoCopy && user));
  const [busy, setBusy] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  // Set when the copy worked but had to leave properties out — shown before opening the copy.
  const [copied, setCopied] = useState<CopyResult | null>(null);
  const [unpublishing, setUnpublishing] = useState(false);
  const [featuring, setFeaturing] = useState(false);
  const [unpublishError, setUnpublishError] = useState<string | null>(null);

  const manageable = groups.filter((group) => group.role === "owner" || group.role === "admin");

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<ChallengeDetail>(API_PATHS.template(challengeId), { signal: controller.signal })
      .then(setDetail)
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(f.error(cause));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challengeId]);

  // The copy dialog: what comes along, then where it lands (a group you run, or just you).
  const [copyMode, setCopyMode] = useState<"structure_and_items" | "structure">("structure_and_items");
  const [where, setWhere] = useState<"personal" | "existing">("personal");
  const [targetId, setTargetId] = useState<Id>(manageable[0]?.id ?? "");
  const ready = where === "personal" || Boolean(targetId);

  async function duplicate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setCopyError(null);
    try {
      const targetGroupId = where === "existing" ? targetId : null;
      if (where === "existing" && !targetGroupId) throw new Error(t("errPickGroup"));
      const result = await apiRequest<{ challengeId: Id; skippedProperties?: SkippedProperty[] }>(API_PATHS.templateDuplicate(challengeId), {
        method: "POST",
        // "Just me": the server puts it in your own space (no group, no invites).
        body: where === "personal" ? { target: "personal", mode: copyMode } : { targetGroupId, mode: copyMode },
        csrfToken,
      });
      if (result.skippedProperties?.length) setCopied({ challengeId: result.challengeId, skippedProperties: result.skippedProperties });
      else onDuplicated(result);
    } catch (cause) {
      setCopyError(f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    setUnpublishing(true);
    setUnpublishError(null);
    try {
      await apiRequest(API_PATHS.challengeTemplate(challengeId), { method: "DELETE", csrfToken });
      onUnpublished?.();
    } catch (cause) {
      setUnpublishError(f.error(cause));
      setUnpublishing(false);
    }
  }

  async function toggleFeatured() {
    if (!detail) return;
    const featured = !detail.templateFeatured;
    setFeaturing(true);
    setUnpublishError(null);
    try {
      await apiRequest(API_PATHS.challengeTemplateFeatured(challengeId), { method: "POST", body: { featured }, csrfToken });
      setDetail({ ...detail, templateFeatured: featured });
    } catch (cause) {
      setUnpublishError(f.error(cause));
    } finally {
      setFeaturing(false);
    }
  }

  // Pills on the dark challenge card, the same family as a challenge's "Download PDF" / "Download pages".
  const pill = "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-4 text-sm transition disabled:cursor-default disabled:opacity-50";
  const outline = "border border-white/35 text-[var(--spotlight-ink)] hover:border-white/60 hover:bg-white/5";
  const headerActions = (
    <>
      <button type="button" className={cx(pill, "bg-[var(--spotlight-ink)] font-medium hover:opacity-90")} onClick={() => (user ? setShowCopy(true) : onSignIn())}>
        <span className="inline-flex items-center gap-2 text-[var(--spotlight)]">
          <svg viewBox="0 0 20 20" className="size-4 flex-none" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="7" y="7" width="9" height="9" rx="2" /><path d="M13 4H6a2 2 0 0 0-2 2v7" strokeLinecap="round" /></svg>
          {user ? t("duplicateCta") : t("signInToDuplicate")}
        </span>
      </button>
      {canPublish ? (
        <button type="button" className={cx(pill, outline)} disabled={featuring} onClick={() => void toggleFeatured()}>
          <CirclePinIcon filled={Boolean(detail?.templateFeatured)} className="size-4 flex-none" />
          {detail?.templateFeatured ? t("unfeature") : t("feature")}
        </button>
      ) : null}
      {canPublish ? (
        <button type="button" className={cx(pill, outline, "hover:border-[var(--main-2)] hover:text-[var(--main-2)]")} disabled={unpublishing} onClick={() => void unpublish()}>
          <CircleMinusIcon className="size-4 flex-none" />
          {t("unpublish")}
        </button>
      ) : null}
    </>
  );

  const body = error ? (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <BackButton onClick={onBack} label={backLabel ?? t("allTemplates")} className="mb-6" />
      <StatusMessage error={error} />
    </main>
  ) : !detail ? (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <BackButton onClick={onBack} label={backLabel ?? t("allTemplates")} className="mb-6" />
      <p className="text-sm text-[var(--muted)]" role="status">{t("detailLoading")}</p>
    </main>
  ) : (
    <>
      <ParticipantChallengeScreen
        preview
        user={user}
        challenge={detail}
        entries={[]}
        tab="results"
        onTab={() => undefined}
        onBack={onBack}
        backLabel={backLabel}
        previewActions={headerActions}
      />
      {unpublishError ? (
        <div className="mx-auto max-w-7xl px-4 sm:px-6"><StatusMessage error={unpublishError} /></div>
      ) : null}
      {user && showCopy ? (
        <Dialog title={t("duplicateAria")} onClose={() => setShowCopy(false)} busy={busy}>
          {copied ? <SkippedPropertiesNotice skipped={copied.skippedProperties} onOpen={() => { if (copied.challengeId) onDuplicated({ challengeId: copied.challengeId }); }} /> : null}
          <form className="space-y-6" onSubmit={duplicate} hidden={Boolean(copied)}>
            <div>
              <p className={labelClass}>{t("copyModeLabel")}</p>
              <SelectableCards
                value={copyMode}
                onChange={setCopyMode}
                disabled={busy}
                options={[
                  { value: "structure_and_items", label: t("copyModeItems"), hint: t("copyModeItemsHint") },
                  { value: "structure", label: t("copyModeStructure"), hint: t("copyModeStructureHint") },
                ]}
              />
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{t("duplicateBody")}</p>
            </div>
            <div>
              <p className={labelClass}>{t("whereLabel")}</p>
              <SelectableCards
                value={where}
                onChange={setWhere}
                disabled={busy}
                options={[
                  // Just you first (and picked); a group only when you run one.
                  { value: "personal" as const, label: t("whereMine"), hint: t("whereMineHint") },
                  ...(manageable.length ? [{ value: "existing" as const, label: t("whereExisting"), hint: t("whereExistingHint") }] : []),
                ]}
              />
              {where === "existing" ? (
                <Select className="mt-3" value={targetId} onChange={setTargetId} ariaLabel={t("whereExisting")} disabled={busy}
                  options={manageable.map((group) => ({ value: group.id, label: group.kind === "personal" ? tm("personal") : group.name }))} />
              ) : null}
            </div>
            <StatusMessage error={copyError} />
            <ModalActions className="border-t border-[var(--line)] pt-4">
              <Button type="submit" disabled={busy || !ready}>{busy ? t("duplicating") : t("duplicateSubmit")}</Button>
            </ModalActions>
          </form>
        </Dialog>
      ) : null}
    </>
  );

  return <PublicChrome user={user} onSignIn={onSignIn}>{body}</PublicChrome>;
}
