"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { SkippedPropertiesNotice } from "../copy-notice";
import { ConfirmDialog, Dialog } from "../dialog";
import { useGoaFormat } from "../format";
import { PreflightPanel } from "../preflight-panel";
import type { ChallengeDetail, CopyResult, Id } from "../types";
import { BoxSection, Button, ChallengeStatusBadge, labelClass, PageHeading, Select, SelectableCards, StatusMessage, Toggle } from "../ui";
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
  </Dialog>;
}

/**
 * Platform admins: the challenge in (or out of) the public template gallery, a switch like the public page's. The
 * box has its top-right corner folded down in ink: only the platform's admins ever see it.
 */
function TemplatePanel({ challenge, onPublish, onUnpublish }: {
  challenge: ChallengeDetail;
  onPublish: () => Promise<void>;
  onUnpublish: () => Promise<void>;
}) {
  const tx = useTranslations("managementUX");
  const f = useGoaFormat();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function turn(on: boolean) {
    setBusy(true); setError(null);
    try { await (on ? onPublish() : onUnpublish()); } catch (cause) { setError(f.error(cause)); } finally { setBusy(false); }
  }

  return (
    <section className="relative overflow-hidden rounded-[20px] border border-[var(--line)] p-5 sm:p-6">
      {/* A dog-ear: the top-right corner folded down in ink, the mark of a setting only Goa's admins see. */}
      <span role="img" aria-label={tx("adminOnly")} title={tx("adminOnly")} className="absolute right-0 top-0 h-4 w-4 rounded-bl-[4px] bg-[linear-gradient(225deg,var(--canvas)_50%,var(--ink)_50%)]" />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-medium tracking-tight">{tx("menuTemplateTitle")}</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{tx("menuTemplateHint")}</p>
        </div>
        <Toggle className="mt-1 flex-none" checked={Boolean(challenge.publishedAsTemplate)} disabled={busy} onChange={(on) => void turn(on)} ariaLabel={tx("menuTemplateTitle")} />
      </div>
      <StatusMessage error={error} />
    </section>
  );
}

export type CopyMode = "structure" | "structure_and_items";

/**
 * Copy the challenge, drawn like a template's copy dialog: what comes along, then where it lands (just you, or a
 * group you run). The copy keeps the name.
 */
function CopyChallengePanel({ challenge, duplicateTargets, onDuplicate, onOpenCopy }: {
  challenge: ChallengeDetail; duplicateTargets: Target[];
  onDuplicate: (payload: { title: string; targetGroupId?: Id; target?: "personal"; mode: CopyMode }) => Promise<CopyResult>;
  onOpenCopy: (challengeId: Id) => void;
}) {
  const t = useTranslations("adminChallenge");
  const tt = useTranslations("templates");
  const f = useGoaFormat();
  const [mode, setMode] = useState<CopyMode>("structure_and_items");
  const [where, setWhere] = useState<"personal" | "existing">("personal");
  const availableTargets = duplicateTargets.filter((target) => target.challengeCount < target.challengeLimit);
  const [targetId, setTargetId] = useState<Id>(availableTargets[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the copy worked but had to leave properties out — shown before going to the copy.
  const [copied, setCopied] = useState<CopyResult | null>(null);
  const ready = where === "personal" || Boolean(targetId);

  async function copy() {
    if (busy || !ready) return;
    setBusy(true); setError(null);
    try {
      const result = await onDuplicate(where === "personal"
        ? { title: challenge.title, target: "personal", mode }
        : { title: challenge.title, targetGroupId: targetId, mode });
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
  return (
    <form className="space-y-6" onSubmit={(event) => { event.preventDefault(); void copy(); }}>
      <div>
        <p className={labelClass}>{tt("copyModeLabel")}</p>
        <SelectableCards
          value={mode}
          onChange={setMode}
          disabled={busy}
          options={[
            { value: "structure_and_items", label: tt("copyModeItems"), hint: tt("copyModeItemsHint") },
            { value: "structure", label: tt("copyModeStructure"), hint: tt("copyModeStructureHint") },
          ]}
        />
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{tt("copyModeHint")}</p>
      </div>
      <div>
        <p className={labelClass}>{tt("whereLabel")}</p>
        <SelectableCards
          value={where}
          onChange={setWhere}
          disabled={busy}
          options={[
            { value: "personal" as const, label: tt("whereMine"), hint: tt("whereMineHint") },
            ...(duplicateTargets.length ? [{ value: "existing" as const, label: tt("whereExisting"), hint: tt("whereExistingHint") }] : []),
          ]}
        />
        {where === "existing" ? (
          <Select className="mt-3" value={targetId} onChange={setTargetId} ariaLabel={tt("whereExisting")} disabled={busy} placeholder={t("reuseTargetPlaceholder")}
            options={duplicateTargets.map((target) => {
              const full = target.challengeCount >= target.challengeLimit;
              return { value: target.id, disabled: full, label: t("reuseTargetOption", { name: target.name, count: target.challengeCount, limit: target.challengeLimit }) + (full ? t("reuseTargetFull") : "") };
            })} />
        ) : null}
      </div>
      <StatusMessage error={error} />
      <Button type="submit" className="w-full" disabled={busy || !ready}>{busy ? t("reuseCreating") : t("reuseSubmit")}</Button>
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

/**
 * Manage's Settings tab: what applies to the challenge as a whole, each with its controls in place — the public
 * page, copying it to another group, the template gallery (platform admins) and, last, deleting it (which still
 * asks once, since it takes the challenge away).
 */
export function ChallengeSettings({ challenge, duplicateTargets, onDuplicate, onOpenCopy, onDelete, isPlatformAdmin, onPublishTemplate, onUnpublishTemplate, onPublish, onUnpublish }: {
  challenge: ChallengeDetail; duplicateTargets: Target[];
  onDuplicate: (payload: { title: string; targetGroupId?: Id; target?: "personal"; mode: CopyMode }) => Promise<CopyResult>;
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
      <PageHeading title={tx("settingsTitle")} />
      <div className="space-y-4">
        <PublicationPanel challenge={challenge} onPublish={onPublish} onUnpublish={onUnpublish} />
        <BoxSection title={tx("menuCopyTitle")} hint={tx("menuCopyHint")}>
          <CopyChallengePanel challenge={challenge} duplicateTargets={duplicateTargets} onDuplicate={onDuplicate} onOpenCopy={onOpenCopy} />
        </BoxSection>
        {isPlatformAdmin ? (
          <TemplatePanel challenge={challenge} onPublish={onPublishTemplate} onUnpublish={onUnpublishTemplate} />
        ) : null}
        {onDelete ? (
          <BoxSection title={t("delete")} hint={tx("menuDeleteHint")} danger>
            <Button variant="danger" className="w-full" onClick={() => setDeleting(true)}>{tx("settingsDeleteAction")}</Button>
          </BoxSection>
        ) : null}
      </div>
      {deleting && onDelete ? (
        <ConfirmDialog
          title={t("deleteTitle")}
          body={challenge.publishedAsTemplate ? <>{t("deleteBody")} {t("deleteBodyTemplateWarning")}</> : t("deleteBody")}
          danger
          onClose={() => setDeleting(false)}
          onConfirm={async () => { await onDelete(); setDeleting(false); }}
        />
      ) : null}
    </div>
  );
}
