"use client";

import { type ReactNode, useState } from "react";
import { useTranslations } from "next-intl";
import { SkippedPropertiesNotice } from "../copy-notice";
import { ConfirmDialog, Dialog } from "../dialog";
import { useGoaFormat } from "../format";
import { PreflightPanel } from "../preflight-panel";
import type { ChallengeDetail, CopyResult, Id } from "../types";
import { Button, ChallengeStatusBadge, cx, inputClass, labelClass, PageHeading, SelectableCards, StatusMessage } from "../ui";
import { isChallengeScheduled, isLivingList } from "../utils";
import { PublicationPanel } from "./publication";

type Target = { id: Id; name: string; challengeCount: number; challengeLimit: number };

/** Lifecycle (activate / close / reopen) + the pre-activation readiness check, in a dialog. */
function ChallengeStateDialog({ challenge, onTransition, onClose }: {
  challenge: ChallengeDetail;
  onTransition: (status: "active" | "closed") => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const longDate: Intl.DateTimeFormatOptions = { day: "2-digit", month: "long", year: "numeric" };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preflightReady, setPreflightReady] = useState(false);
  const scheduled = isChallengeScheduled(challenge.status, challenge.startsOn, challenge.submissionMode);

  async function run(action: "activate" | "close" | "reopen") {
    setBusy(true); setError(null);
    try {
      await onTransition(action === "close" ? "closed" : "active");
    } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
  }

  return <Dialog title={t("stateTitle")} onClose={onClose} busy={busy}>
    <div className="rounded-2xl bg-[var(--wash)] p-5">
      <ChallengeStatusBadge status={challenge.status} startsOn={challenge.startsOn} submissionMode={challenge.submissionMode} />
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{challenge.status === "draft" ? t("stateDraft") : scheduled ? t("stateScheduled", { date: f.date(challenge.startsOn, longDate) }) : challenge.status === "active" ? t("stateActive") : t("stateClosed")}</p>
      <div className="mt-4">
        {challenge.status === "draft" ? <Button disabled={busy || !preflightReady} onClick={() => void run("activate")}>{busy ? tc("saving") : t("activate")}</Button> : null}
        {challenge.status === "active" ? <Button variant="danger" disabled={busy} onClick={() => void run("close")}>{busy ? tc("saving") : t("close")}</Button> : null}
        {challenge.status === "closed" ? <Button variant="secondary" disabled={busy} onClick={() => void run("reopen")}>{busy ? tc("saving") : t("reopen")}</Button> : null}
      </div>
    </div>
    {challenge.status === "draft" && !isLivingList(challenge) ? (
      <div className="mt-6 border-t border-[var(--line)] pt-6"><PreflightPanel challengeId={challenge.id} onReady={setPreflightReady} /></div>
    ) : null}
    <StatusMessage error={error} />
    <div className="mt-6 flex justify-end border-t border-[var(--line)] pt-4"><Button variant="secondary" onClick={onClose} disabled={busy}>{tc("close")}</Button></div>
  </Dialog>;
}

/** Platform admins: put the challenge in (or take it out of) the public template gallery. */
function TemplatePanel({ challenge, onPublish, onUnpublish }: {
  challenge: ChallengeDetail;
  onPublish: () => Promise<void>;
  onUnpublish: () => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [busy, setBusy] = useState<"publish" | "unpublish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const published = Boolean(challenge.publishedAsTemplate);

  async function run(kind: "publish" | "unpublish", action: () => Promise<void>, ok: string) {
    setBusy(kind); setError(null); setSuccess(null);
    try { await action(); setSuccess(ok); } catch (cause) { setError(f.error(cause)); } finally { setBusy(null); }
  }

  return (
    <div>
      {published ? (
        <div className="flex flex-wrap items-center gap-3">
          {/* No "Listed in the gallery" line: the remove button already says it's there. */}
          <Button variant="danger" disabled={busy !== null} onClick={() => void run("unpublish", onUnpublish, t("platformTemplateRemoved"))}>{busy === "unpublish" ? tc("saving") : t("platformTemplateUnpublish")}</Button>
        </div>
      ) : (
        <Button disabled={busy !== null} onClick={() => void run("publish", onPublish, t("platformTemplatePublished"))}>{busy === "publish" ? tc("saving") : t("platformTemplatePublish")}</Button>
      )}
      <StatusMessage error={error} success={success} />
    </div>
  );
}

export type CopyMode = "structure" | "structure_and_items";

/** Copy the challenge into another group — a name, where it goes, and what comes along. */
function CopyChallengePanel({ challenge, duplicateTargets, onDuplicate, onOpenCopy }: {
  challenge: ChallengeDetail; duplicateTargets: Target[];
  onDuplicate: (payload: { title: string; targetGroupId: Id; mode: CopyMode }) => Promise<CopyResult>;
  onOpenCopy: (challengeId: Id) => void;
}) {
  const t = useTranslations("adminChallenge");
  const tt = useTranslations("templates");
  const f = useGoaFormat();
  const [mode, setMode] = useState<CopyMode>("structure_and_items");
  const [duplicateTitle, setDuplicateTitle] = useState(challenge.title);
  const availableTargets = duplicateTargets.filter((target) => target.challengeCount < target.challengeLimit);
  const [duplicateTargetGroupId, setDuplicateTargetGroupId] = useState<Id>(availableTargets[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the copy worked but had to leave properties out — shown before going to the copy.
  const [copied, setCopied] = useState<CopyResult | null>(null);

  async function copy() {
    if (!duplicateTargetGroupId) { setError(t("reusePickTarget")); return; }
    setBusy(true); setError(null);
    try {
      const result = await onDuplicate({ title: duplicateTitle.trim(), targetGroupId: duplicateTargetGroupId, mode });
      if (result.skippedProperties.length) { setCopied(result); return; }
      if (result.challengeId) onOpenCopy(result.challengeId);
    } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
  }

  if (copied) {
    return (
      <div>
        <p className="text-sm leading-6 text-[var(--muted)]">{t("reuseDoneBody")}</p>
        <SkippedPropertiesNotice skipped={copied.skippedProperties} onOpen={() => { if (copied.challengeId) onOpenCopy(copied.challengeId); }} />
      </div>
    );
  }
  if (!duplicateTargets.length) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--wash)]/60 p-5">
        <strong className="text-sm">{t("reuseNoneTitle")}</strong>
        <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("reuseNoneBody")}</p>
      </div>
    );
  }
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void copy(); }}>
      <label>
        <span className={labelClass}>{t("reuseTitleLabel")}</span>
        <input className={inputClass} value={duplicateTitle} onChange={(event) => setDuplicateTitle(event.target.value)} required maxLength={160} />
      </label>
      <label>
        <span className={labelClass}>{t("reuseTargetLabel")}</span>
        <select className={inputClass} value={duplicateTargetGroupId} onChange={(event) => setDuplicateTargetGroupId(event.target.value)} required>
          <option value="">{t("reuseTargetPlaceholder")}</option>
          {duplicateTargets.map((target) => {
            const full = target.challengeCount >= target.challengeLimit;
            return (
              <option key={target.id} value={target.id} disabled={full}>
                {t("reuseTargetOption", { name: target.name, count: target.challengeCount, limit: target.challengeLimit })}
                {full ? t("reuseTargetFull") : ""}
              </option>
            );
          })}
        </select>
      </label>
      <div className="sm:col-span-2">
        <span className={labelClass}>{tt("copyModeLabel")}</span>
        <SelectableCards
          value={mode}
          onChange={setMode}
          options={[
            { value: "structure_and_items", label: tt("copyModeItems"), hint: tt("copyModeItemsHint") },
            { value: "structure", label: tt("copyModeStructure"), hint: tt("copyModeStructureHint") },
          ]}
        />
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{tt("copyModeHint")}</p>
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={busy || !duplicateTargetGroupId || !availableTargets.length}>{busy ? t("reuseCreating") : t("reuseSubmit")}</Button>
        <StatusMessage error={error} />
      </div>
    </form>
  );
}

/** The lifecycle button in Manage's header — activate a draft, close an active round, reopen a closed one. */
export function ChallengeStateButton({ challenge, onTransition }: {
  challenge: ChallengeDetail;
  onTransition: (status: "active" | "closed") => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const [open, setOpen] = useState(false);
  const stateAction = isLivingList(challenge) ? null
    : challenge.status === "draft" ? { label: t("activate"), variant: "primary" as const }
    : challenge.status === "active" ? { label: t("close"), variant: "danger" as const }
    : { label: t("reopen"), variant: "secondary" as const };
  if (!stateAction) return null;
  return <>
    <Button variant={stateAction.variant} onClick={() => setOpen(true)}>{stateAction.label}</Button>
    {open ? <ChallengeStateDialog challenge={challenge} onTransition={onTransition} onClose={() => setOpen(false)} /> : null}
  </>;
}

/** One section of Settings: its name, a line on what it does, and its controls right there. */
function SettingSection({ title, hint, danger = false, children }: { title: string; hint: string; danger?: boolean; children: ReactNode }) {
  return (
    <section className="py-8 first:pt-0">
      <h2 className={cx("text-lg font-medium tracking-tight", danger && "text-[var(--danger)]")}>{title}</h2>
      <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{hint}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * Manage's Settings tab: what applies to the challenge as a whole, each with its controls in place — the public
 * page, copying it to another group, the template gallery (platform admins) and, last, deleting it (which still
 * asks once, since it takes the challenge away).
 */
export function ChallengeSettings({ challenge, duplicateTargets, onDuplicate, onOpenCopy, onDelete, isPlatformAdmin, onPublishTemplate, onUnpublishTemplate, onPublish, onUnpublish }: {
  challenge: ChallengeDetail; duplicateTargets: Target[];
  onDuplicate: (payload: { title: string; targetGroupId: Id; mode: CopyMode }) => Promise<CopyResult>;
  onOpenCopy: (challengeId: Id) => void;
  onDelete?: () => Promise<void>;
  isPlatformAdmin: boolean;
  onPublishTemplate: () => Promise<void>;
  onUnpublishTemplate: () => Promise<void>;
  onPublish: (payload: Record<string, unknown>) => Promise<{ url?: string | null } | undefined>;
  onUnpublish: () => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tx = useTranslations("managementUX");
  const [deleting, setDeleting] = useState(false);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeading title={tx("settingsTitle")} description={tx("settingsSubtitle")} />
      <div className="divide-y divide-[var(--line)]">
        <SettingSection title={tx("menuPublicTitle")} hint={tx("menuPublicHint")}>
          <PublicationPanel challenge={challenge} onPublish={onPublish} onUnpublish={onUnpublish} />
        </SettingSection>
        <SettingSection title={tx("menuCopyTitle")} hint={tx("menuCopyHint")}>
          <CopyChallengePanel challenge={challenge} duplicateTargets={duplicateTargets} onDuplicate={onDuplicate} onOpenCopy={onOpenCopy} />
        </SettingSection>
        {isPlatformAdmin ? (
          <SettingSection title={tx("menuTemplateTitle")} hint={tx("menuTemplateHint")}>
            <TemplatePanel challenge={challenge} onPublish={onPublishTemplate} onUnpublish={onUnpublishTemplate} />
          </SettingSection>
        ) : null}
        {onDelete ? (
          <SettingSection title={t("delete")} hint={tx("menuDeleteHint")} danger>
            <Button variant="danger" onClick={() => setDeleting(true)}>{tx("settingsDeleteAction")}</Button>
          </SettingSection>
        ) : null}
      </div>
      {deleting && onDelete ? (
        <ConfirmDialog
          title={t("deleteTitle")}
          body={challenge.publishedAsTemplate ? <>{t("deleteBody")} {t("deleteBodyTemplateWarning")}</> : t("deleteBody")}
          confirmLabel={t("delete")}
          danger
          onClose={() => setDeleting(false)}
          onConfirm={async () => { await onDelete(); setDeleting(false); }}
        />
      ) : null}
    </div>
  );
}
