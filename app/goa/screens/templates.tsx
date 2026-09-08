"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";

import { API_PATHS, apiRequest } from "../api";
import { useGoaFormat } from "../format";
import { SettingsMenu } from "../SettingsMenu";
import type {
  ChallengeDetail,
  ChallengeSummary,
  GroupSummary,
  Id,
  TemplateSummary,
  User,
} from "../types";
import { backLinkClass, Brand, Button, cardClass, cx, EmptyState, inputClass, labelClass, PageHeading, StatusMessage } from "../ui";
import { ParticipantChallengeScreen } from "./participant-challenge";

function PublicChrome({ user, onSignIn, children }: { user: User | null; onSignIn: () => void; children: ReactNode }) {
  const t = useTranslations("templates");
  if (user) return <>{children}</>;
  return (
    <div className="flex min-h-screen flex-col bg-[var(--canvas)] text-[var(--ink)]">
      <header className="sticky top-0 z-30 border-b border-[var(--edge)] bg-[var(--canvas)]/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:h-[76px] sm:px-6">
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
  manageableChallenges,
  onOpen,
  onBack,
  onSignIn,
  csrfToken,
  onChanged,
}: {
  user: User | null;
  manageableChallenges: ChallengeSummary[];
  onOpen: (challengeId: Id) => void;
  onBack: () => void;
  onSignIn: () => void;
  csrfToken: string;
  onChanged: () => void;
}) {
  const t = useTranslations("templates");
  const f = useGoaFormat();
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminSuccess, setAdminSuccess] = useState<string | null>(null);

  async function load() {
    try {
      const response = await apiRequest<{ templates: TemplateSummary[] }>(API_PATHS.templates);
      setTemplates(response.templates);
    } catch (cause) {
      setError(f.error(cause));
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ templates: TemplateSummary[] }>(API_PATHS.templates, { signal: controller.signal })
      .then((response) => setTemplates(response.templates))
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(f.error(cause));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const publishedIds = useMemo(() => new Set((templates ?? []).map((template) => template.id)), [templates]);
  const canPublish = Boolean(user?.platformAdmin);
  const publishable = canPublish
    ? manageableChallenges.filter((challenge) => !publishedIds.has(challenge.id))
    : [];

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const challengeId = String(data.get("challengeId") ?? "");
    const summary = String(data.get("summary") ?? "").trim();
    if (!challengeId) return;
    setAdminBusy(true);
    setAdminError(null);
    setAdminSuccess(null);
    try {
      await apiRequest(API_PATHS.challengeTemplate(challengeId), {
        method: "POST",
        body: summary ? { summary } : {},
        csrfToken,
      });
      setAdminSuccess(t("published"));
      form.reset();
      await load();
      onChanged();
    } catch (cause) {
      setAdminError(f.error(cause));
    } finally {
      setAdminBusy(false);
    }
  }

  const body = (
    <main className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <button className={cx(backLinkClass, "mb-6")} type="button" onClick={onBack}>{t("back")}</button>
      <PageHeading title={t("title")} description={t("subtitle")} />

      {canPublish ? (
        <section className={cx(cardClass, "mb-8 p-5")} aria-labelledby="publish-template-title">
          <h2 id="publish-template-title" className="text-lg font-light">{t("publishTitle")}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{t("publishBody")}</p>
          <form className="mt-4 grid gap-4 sm:grid-cols-[1fr_1.4fr_auto]" onSubmit={publish}>
            <label><span className={labelClass}>{t("publishChallengeLabel")}</span>
              <select className={inputClass} name="challengeId" defaultValue="" required>
                <option value="" disabled>{t("publishChoose")}</option>
                {publishable.map((challenge) => (
                  <option key={challenge.id} value={challenge.id}>{challenge.title}</option>
                ))}
              </select>
            </label>
            <label><span className={labelClass}>{t("publishSummaryLabel")}</span>
              <input className={inputClass} name="summary" maxLength={280} placeholder={t("publishSummaryPlaceholder")} />
            </label>
            <div className="flex items-end"><Button type="submit" disabled={adminBusy || !publishable.length}>{adminBusy ? t("publishing") : t("publish")}</Button></div>
          </form>
          <div className="mt-3"><StatusMessage error={adminError} success={adminSuccess} /></div>
        </section>
      ) : null}

      <div className="mt-2"><StatusMessage error={error} /></div>

      {templates === null ? (
        <p className="mt-6 text-sm text-[var(--muted)]" role="status">{t("loading")}</p>
      ) : templates.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
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
                  {t("cardMeta", { rules: template.ruleCount, fieldCount: template.fieldCount })}
                  {template.itemCount ? t("cardItems", { count: template.itemCount }) : ""}
                  {template.metricCount ? t("cardMetrics", { count: template.metricCount }) : ""}
                </p>
              </div>
              <span className="block w-full bg-[var(--main-line)] px-5 py-3.5" aria-hidden="true" />
            </article>
          ))}
        </div>
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
  const [unpublishing, setUnpublishing] = useState(false);
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
      const result = await apiRequest<{ challengeId: Id }>(API_PATHS.templateDuplicate(challengeId), {
        method: "POST",
        body: { targetGroupId },
        csrfToken,
      });
      onDuplicated(result);
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

  const headerActions = (
    <>
      <Button onClick={() => (user ? setShowCopy((open) => !open) : onSignIn())}>
        {user ? (showCopy ? t("closeCopy") : t("duplicateCta")) : t("signInToDuplicate")}
      </Button>
      {canPublish ? (
        <Button variant="danger" disabled={unpublishing} onClick={() => void unpublish()}>
          {t("unpublish")}
        </Button>
      ) : null}
    </>
  );

  const body = error ? (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <button className={cx(backLinkClass, "mb-6")} type="button" onClick={onBack}>{t("allTemplates")}</button>
      <StatusMessage error={error} />
    </main>
  ) : !detail ? (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <button className={cx(backLinkClass, "mb-6")} type="button" onClick={onBack}>{t("allTemplates")}</button>
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
        previewActions={headerActions}
      />
      {unpublishError ? (
        <div className="mx-auto max-w-7xl px-4 sm:px-6"><StatusMessage error={unpublishError} /></div>
      ) : null}
      {user && showCopy ? (
        <div className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
          <section className={cx(cardClass, "p-5")} aria-label={t("duplicateAria")}>
            <p className="text-sm text-[var(--muted)]">{t("duplicateBody")}</p>
            <form className="mt-4 grid gap-3" onSubmit={duplicate}>
              <label><span className={labelClass}>{t("targetGroupLabel")}</span>
                <select className={inputClass} name="target" defaultValue={manageable[0]?.id ?? "__new__"}>
                  {manageable.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                  <option value="__new__">{t("newGroupOption")}</option>
                </select>
              </label>
              <label><span className={labelClass}>{t("newGroupNameLabel")}</span>
                <input className={inputClass} name="newGroupName" maxLength={120} placeholder={detail.title} />
              </label>
              <div><Button type="submit" disabled={busy}>{busy ? t("duplicating") : t("duplicateSubmit")}</Button></div>
              <StatusMessage error={copyError} />
            </form>
          </section>
        </div>
      ) : null}
    </>
  );

  return <PublicChrome user={user} onSignIn={onSignIn}>{body}</PublicChrome>;
}
