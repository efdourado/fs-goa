"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ActionMenu, ActionMenuItem } from "../action-menu";
import { ConfirmDialog, Dialog } from "../dialog";
import { useGoaFormat } from "../format";
import type { ChallengeDetail, Id } from "../types";
import { Button, inputClass, labelClass, StatusMessage } from "../ui";
import { PublicationDialog } from "./publication";

type Target = { id: Id; name: string; challengeCount: number; challengeLimit: number };

function TemplatePublishSection({ challenge, onPublish, onUnpublish }: {
  challenge: ChallengeDetail;
  onPublish: (summary: string) => Promise<void>;
  onUnpublish: () => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [summary, setSummary] = useState(challenge.templateSummary ?? "");
  const [busy, setBusy] = useState<"publish" | "unpublish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const published = Boolean(challenge.publishedAsTemplate);

  async function run(kind: "publish" | "unpublish", action: () => Promise<void>, ok: string) {
    setBusy(kind);
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(ok);
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="border-t border-[var(--line)] pt-10">
      <h2 className="text-lg font-medium tracking-tight">{t("platformTemplateTitle")}</h2>
      <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("platformTemplateHint")}</p>
      {published ? (
        <div className="mt-4 grid gap-3 sm:max-w-xl">
          <p className="text-sm text-[var(--ok)]">{t("platformTemplateOn")}</p>
          <label>
            <span className={labelClass}>{t("summaryLabel")}</span>
            <textarea className={inputClass} rows={2} value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={280} placeholder={challenge.description ?? ""} />
          </label>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" disabled={busy !== null} onClick={() => void run("publish", () => onPublish(summary.trim()), t("platformTemplateSaved"))}>{busy === "publish" ? tc("saving") : tc("saveChanges")}</Button>
            <Button variant="danger" disabled={busy !== null} onClick={() => void run("unpublish", onUnpublish, t("platformTemplateRemoved"))}>{busy === "unpublish" ? tc("saving") : t("platformTemplateUnpublish")}</Button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <Button disabled={busy !== null} onClick={() => void run("publish", () => onPublish(summary.trim()), t("platformTemplatePublished"))}>{busy === "publish" ? tc("saving") : t("platformTemplatePublish")}</Button>
        </div>
      )}
      <StatusMessage error={error} success={success} />
    </section>
  );
}


function CopyChallengeDialog({ challenge, duplicateTargets, onDuplicate, onClose }: {
  challenge: ChallengeDetail; duplicateTargets: Target[];
  onDuplicate: (payload: { title: string; targetGroupId: Id }) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations("adminChallenge");
  const tc = useTranslations("common");
  const f = useGoaFormat();
  const [duplicateTitle, setDuplicateTitle] = useState(challenge.title);
  const availableTargets = duplicateTargets.filter((target) => target.challengeCount < target.challengeLimit);
  const [duplicateTargetGroupId, setDuplicateTargetGroupId] = useState<Id>(availableTargets[0]?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function copy() {
    setBusy("duplicate"); setError(null);
    try { await onDuplicate({ title: duplicateTitle.trim(), targetGroupId: duplicateTargetGroupId }); onClose(); }
    catch (cause) { setError(f.error(cause)); } finally { setBusy(null); }
  }
  return <Dialog title={t("reuseTitle")} onClose={onClose} busy={Boolean(busy)}>
    <p className="text-sm leading-6 text-[var(--muted)]">{t("reuseBody")}</p>
        {duplicateTargets.length ? <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (!duplicateTargetGroupId) { setError(t("reusePickTarget")); return; } void copy(); }}>
          <label>
            <span className={labelClass}>{t("reuseTitleLabel")}</span>
            <input
              className={inputClass}
              value={duplicateTitle}
              onChange={(event) => setDuplicateTitle(event.target.value)}
              required
              maxLength={160} />
          </label>

          <label>
            <span className={labelClass}>{t("reuseTargetLabel")}</span>

            <select
              className={inputClass}
              value={duplicateTargetGroupId}
              onChange={(event) => setDuplicateTargetGroupId(event.target.value)}
              required
            >
              <option value="">{t("reuseTargetPlaceholder")}</option>

              {duplicateTargets.map((target) => {
                const full = target.challengeCount >= target.challengeLimit;

                return (
                  <option key={target.id} value={target.id} disabled={full}>
                    {t("reuseTargetOption", {
                      name: target.name,
                      count: target.challengeCount,
                      limit: target.challengeLimit,
                    })}
                    {full ? t("reuseTargetFull") : ""}
                  </option>
                );
              })}
            </select>
          </label>
            
          <div className="mb-1"><Button type="submit" variant="secondary" disabled={busy === "duplicate" || !duplicateTargetGroupId || !availableTargets.length}>{busy === "duplicate" ? t("reuseCreating") : t("reuseSubmit")}</Button></div>
        </form> : <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--wash)]/60 p-5"><strong className="text-sm">{t("reuseNoneTitle")}</strong><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("reuseNoneBody")}</p></div>}

    <StatusMessage error={error} />
    <div className="mt-5 flex justify-end"><Button variant="ghost" disabled={Boolean(busy)} onClick={onClose}>{tc("cancel")}</Button></div>
  </Dialog>;
}

export function ChallengeActions({ challenge, duplicateTargets, onDuplicate, onDelete, isPlatformAdmin, onPublishTemplate, onUnpublishTemplate, onPublish, onUnpublish }: {
  challenge: ChallengeDetail; duplicateTargets: Target[];
  onDuplicate: (payload: { title: string; targetGroupId: Id }) => Promise<void>;
  onDelete?: () => Promise<void>;
  isPlatformAdmin: boolean;
  onPublishTemplate: (summary: string) => Promise<void>;
  onUnpublishTemplate: () => Promise<void>;
  onPublish: (payload: Record<string, unknown>) => Promise<{ url?: string | null } | undefined>;
  onUnpublish: () => Promise<void>;
}) {
  const t = useTranslations("adminChallenge");
  const tx = useTranslations("managementUX");
  const tc = useTranslations("common");
  const [panel, setPanel] = useState<"copy" | "publication" | "template" | "delete" | null>(null);
  return <>
    <ActionMenu label={tx("moreSettings")}>
      <ActionMenuItem onClick={() => setPanel("publication")}>{tx("publication")}</ActionMenuItem>
      <ActionMenuItem onClick={() => setPanel("copy")}>{t("reuseTitle")}</ActionMenuItem>
      {isPlatformAdmin ? <ActionMenuItem onClick={() => setPanel("template")}>{t("platformTemplateTitle")}</ActionMenuItem> : null}
      {onDelete ? <div className="mt-1 border-t border-[var(--line)] pt-1"><ActionMenuItem danger onClick={() => setPanel("delete")}>{t("delete")}</ActionMenuItem></div> : null}
    </ActionMenu>
    {panel === "copy" ? <CopyChallengeDialog challenge={challenge} duplicateTargets={duplicateTargets} onDuplicate={onDuplicate} onClose={() => setPanel(null)} /> : null}
    {panel === "publication" ? <PublicationDialog challenge={challenge} onPublish={onPublish} onUnpublish={onUnpublish} onClose={() => setPanel(null)} /> : null}
    {panel === "template" && isPlatformAdmin ? <Dialog title={t("platformTemplateTitle")} onClose={() => setPanel(null)}><TemplatePublishSection challenge={challenge} onPublish={onPublishTemplate} onUnpublish={onUnpublishTemplate} /><div className="mt-5 flex justify-end"><Button variant="secondary" onClick={() => setPanel(null)}>{tc("close")}</Button></div></Dialog> : null}
    {panel === "delete" && onDelete ? <ConfirmDialog title={t("deleteTitle")} body={t("deleteBody")} confirmLabel={t("delete")} danger onClose={() => setPanel(null)} onConfirm={async () => { await onDelete(); setPanel(null); }} /> : null}
  </>;
}

