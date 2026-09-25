"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import { API_PATHS, apiRequest } from "../api";
import { SkippedPropertiesNotice } from "../copy-notice";
import { Dialog } from "../dialog";
import { FrontPageStories, pickFrontPage } from "../front-page";
import { useGoaFormat } from "../format";
import { SettingsMenu } from "../SettingsMenu";
import type {
  ChallengeDetail,
  CopyResult,
  GroupSummary,
  Id,
  SkippedProperty,
  TemplateSummary,
  User,
} from "../types";
import { BackButton, Brand, Button, EmptyState, inputClass, labelClass, PageHeading, StatusMessage } from "../ui";
import { ParticipantChallengeScreen } from "./participant-challenge";

function PublicChrome({ user, onSignIn, children }: { user: User | null; onSignIn: () => void; children: ReactNode }) {
  const t = useTranslations("templates");
  if (user) return <>{children}</>;
  return (
    <div className="flex min-h-screen flex-col bg-[var(--canvas)] text-[var(--ink)]">
      <header className="sticky top-0 z-30 border-b border-[var(--edge)] bg-[var(--canvas)]/92 backdrop-blur-xl">
        <div className="flex h-16 items-center justify-between px-4 sm:h-[76px] sm:px-6 lg:px-10">
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
  const f = useGoaFormat();
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ templates: TemplateSummary[] }>(API_PATHS.templates, { signal: controller.signal })
      .then((response) => {
        setTemplates(response.templates);
        if (!response.templates.length) onEmpty?.();
      })
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(f.error(cause));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const front = pickFrontPage(templates ?? []);

  const body = (
    <main className="px-4 py-8 pb-24 sm:px-6 sm:py-12 lg:px-10">
      {user ? (
        <>
          <BackButton onClick={onBack} label={backLabel ?? t("back")} className="mb-6" />
          <PageHeading title={t("title")} description={t("subtitle")} />
        </>
      ) : (
        // Signed out, this is goa's front door: say what it is, then show real results; Sign in waits in the header.
        <header className="mb-10 max-w-3xl">
          <h1 className="text-4xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-6xl">{t("frontTitle")}</h1>
          <p className="mt-4 text-base leading-7 text-[var(--muted)]">{t("frontLede")}</p>
        </header>
      )}

      <div className="mt-2"><StatusMessage error={error} /></div>

      {templates === null ? (
        <p className="mt-6 text-sm text-[var(--muted)]" role="status">{t("loading")}</p>
      ) : templates.length === 0 ? (
        <EmptyState title={t("emptyTitle")} />
      ) : (
        <>
        <FrontPageStories featured={front.featured} onOpen={onOpen} />
        {front.rest.length ? (
          <h2 className="mb-5 mt-14 border-t border-[var(--line)] pt-6 text-lg font-medium tracking-[-0.03em] sm:text-xl">{t("moreTitle")}</h2>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {front.rest.map((template) => (
            <article
              key={template.id}
              className="relative flex flex-col overflow-hidden rounded-[20px] border border-[var(--main-line)] bg-[var(--paper)] shadow-[var(--elevate-1)] transition hover:-translate-y-0.5 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[var(--main)]/25"
            >
              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-block h-2.5 w-2.5 flex-none rounded-full bg-[var(--main-line)] ring-1 ring-inset ring-[var(--edge)]" aria-hidden="true" />
                  <span className="text-xs text-[var(--muted)]">{t(`mode.${template.submissionMode}`)}</span>
                </div>
                <h3 className="mt-5 text-2xl font-light tracking-[-0.04em]">
                  <button type="button" className="cursor-pointer text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none" onClick={() => onOpen(template.id)}>{template.title}</button>
                </h3>
                {template.summary ? <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--muted)]">{template.summary}</p> : null}
                <p className="mt-4 text-xs text-[var(--muted)]">
                  {[
                    template.participantCount ? t("cardPeople", { count: template.participantCount }) : null,
                    template.ruleCount ? t("cardRules", { count: template.ruleCount }) : null,
                    template.fieldCount ? t("cardFields", { count: template.fieldCount }) : null,
                    template.itemCount ? t("cardItems", { count: template.itemCount }) : null,
                    template.metricCount ? t("cardMetrics", { count: template.metricCount }) : null,
                  ].filter(Boolean).join(" · ")}
                </p>
              </div>
              <span className="block w-full bg-[var(--main-line)] px-5 py-3.5" aria-hidden="true" />
            </article>
          ))}
        </div>
        </>
      )}
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

  async function duplicate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const choice = String(data.get("target") ?? "");
    const newGroupName = String(data.get("newGroupName") ?? "").trim();
    setBusy(true);
    setCopyError(null);
    try {
      let targetGroupId = choice;
      if (choice === "__new__") {
        if (!newGroupName) throw new Error(t("errNameGroup"));
        const created = await apiRequest<{ id: Id }>(API_PATHS.groups, {
          method: "POST",
          body: { name: newGroupName },
          csrfToken,
        });
        targetGroupId = created.id;
      }
      if (!targetGroupId) throw new Error(t("errPickGroup"));
      const result = await apiRequest<{ challengeId: Id; skippedProperties?: SkippedProperty[] }>(API_PATHS.templateDuplicate(challengeId), {
        method: "POST",
        body: { targetGroupId, mode: data.get("mode") === "structure" ? "structure" : "structure_and_items" },
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

  const headerActions = (
    <>
      <Button onClick={() => (user ? setShowCopy(true) : onSignIn())}>
        {user ? t("duplicateCta") : t("signInToDuplicate")}
      </Button>
      {canPublish ? (
        <Button variant="secondary" disabled={featuring} onClick={() => void toggleFeatured()}>
          {detail?.templateFeatured ? t("unfeature") : t("feature")}
        </Button>
      ) : null}
      {canPublish ? (
        <Button variant="danger" disabled={unpublishing} onClick={() => void unpublish()}>
          {t("unpublish")}
        </Button>
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
          <p className="text-sm text-[var(--muted)]">{t("duplicateBody")}</p>
          {copied ? <SkippedPropertiesNotice skipped={copied.skippedProperties} onOpen={() => { if (copied.challengeId) onDuplicated({ challengeId: copied.challengeId }); }} /> : null}
          <form className="mt-4 grid gap-3" onSubmit={duplicate} hidden={Boolean(copied)}>
            <label><span className={labelClass}>{t("targetGroupLabel")}</span>
              <select className={inputClass} name="target" defaultValue={manageable[0]?.id ?? "__new__"}>
                {manageable.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                <option value="__new__">{t("newGroupOption")}</option>
              </select>
            </label>
            <label><span className={labelClass}>{t("newGroupNameLabel")}</span>
              <input className={inputClass} name="newGroupName" maxLength={120} placeholder={detail.title} />
            </label>
            <label><span className={labelClass}>{t("copyModeLabel")}</span>
              <select className={inputClass} name="mode" defaultValue="structure_and_items">
                <option value="structure_and_items">{t("copyModeItems")}</option>
                <option value="structure">{t("copyModeStructure")}</option>
              </select>
            </label>
            <p className="text-xs text-[var(--muted)]">{t("copyModeHint")}</p>
            <div><Button type="submit" disabled={busy}>{busy ? t("duplicating") : t("duplicateSubmit")}</Button></div>
            <StatusMessage error={copyError} />
          </form>
        </Dialog>
      ) : null}
    </>
  );

  return <PublicChrome user={user} onSignIn={onSignIn}>{body}</PublicChrome>;
}
