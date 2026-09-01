"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";

import { API_PATHS, apiRequest } from "../api";
import { useGoaFormat } from "../format";
import { RuleSectionsView } from "../rules";
import { SettingsMenu } from "../SettingsMenu";
import type {
  ChallengeSummary,
  GroupSummary,
  Id,
  TemplateDetail,
  TemplateSummary,
  User,
} from "../types";
import { backLinkClass, Brand, Button, cardClass, cx, EmptyState, inputClass, labelClass, PageHeading, StatusMessage } from "../ui";

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

  async function unpublish(challengeId: Id) {
    setAdminBusy(true);
    setAdminError(null);
    setAdminSuccess(null);
    try {
      await apiRequest(API_PATHS.challengeTemplate(challengeId), { method: "DELETE", csrfToken });
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
            <article className={cx(cardClass, "relative flex flex-col p-5 transition hover:-translate-y-0.5")} key={template.id}>
              <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--muted)]">{t("cardKicker", { mode: t(`mode.${template.submissionMode}`) })}</p>
              <h3 className="mt-2 text-xl font-light tracking-[-0.03em]">
                <button type="button" className="cursor-pointer text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none" onClick={() => onOpen(template.id)}>{template.title}</button>
              </h3>
              {template.summary ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-[var(--muted)]">{template.summary}</p> : null}
              <p className="mt-4 text-xs text-[var(--muted)]">
                {t("cardMeta", { rules: template.ruleCount, fieldCount: template.fieldCount })}
                {template.itemCount ? t("cardItems", { count: template.itemCount }) : ""}
                {template.metricCount ? t("cardMetrics", { count: template.metricCount }) : ""}
              </p>
              {canPublish ? (
                <button
                  type="button"
                  className="relative z-10 mt-4 cursor-pointer self-start text-xs font-medium text-[var(--danger)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={adminBusy}
                  onClick={() => void unpublish(template.id)}
                >
                  {t("unpublish")}
                </button>
              ) : null}
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
  csrfToken,
  autoCopy = false,
}: {
  user: User | null;
  challengeId: Id;
  groups: GroupSummary[];
  onBack: () => void;
  onSignIn: () => void;
  onDuplicated: (result: { challengeId: Id }) => void;
  csrfToken: string;
  autoCopy?: boolean;
}) {
  const t = useTranslations("templates");
  const tm = useTranslations("metrics");
  const f = useGoaFormat();
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCopy, setShowCopy] = useState(Boolean(autoCopy && user));
  const [busy, setBusy] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const manageable = groups.filter((group) => group.role === "owner" || group.role === "admin");

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<TemplateDetail>(API_PATHS.template(challengeId), { signal: controller.signal })
      .then(setTemplate)
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

  const body = (
    <main className="mx-auto max-w-3xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <button className={cx(backLinkClass, "mb-6")} type="button" onClick={onBack}>{t("allTemplates")}</button>
      {error ? <StatusMessage error={error} /> : !template ? (
        <p className="text-sm text-[var(--muted)]" role="status">{t("detailLoading")}</p>
      ) : (
        <>
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--muted)]">{t("detailKicker", { mode: t(`mode.${template.submissionMode}`), duration: template.durationDays === null ? t("durationNone") : t("durationDays", { count: template.durationDays }) })}</p>
          <h1 className="mt-2 text-3xl font-light tracking-[-0.04em] sm:text-4xl">{template.title}</h1>
          {template.description ? <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{template.description}</p> : null}

          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={() => (user ? setShowCopy((open) => !open) : onSignIn())}>
              {user ? (showCopy ? t("closeCopy") : t("duplicateCta")) : t("signInToDuplicate")}
            </Button>
          </div>

          {user && showCopy ? (
            <section className={cx(cardClass, "mt-4 p-5")} aria-label={t("duplicateAria")}>
              <p className="text-sm text-[var(--muted)]">{t("duplicateBody")}</p>
              <form className="mt-4 grid gap-3" onSubmit={duplicate}>
                <label><span className={labelClass}>{t("targetGroupLabel")}</span>
                  <select className={inputClass} name="target" defaultValue={manageable[0]?.id ?? "__new__"}>
                    {manageable.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                    <option value="__new__">{t("newGroupOption")}</option>
                  </select>
                </label>
                <label><span className={labelClass}>{t("newGroupNameLabel")}</span>
                  <input className={inputClass} name="newGroupName" maxLength={120} placeholder={template.title} />
                </label>
                <div><Button type="submit" disabled={busy}>{busy ? t("duplicating") : t("duplicateSubmit")}</Button></div>
                <StatusMessage error={copyError} />
              </form>
            </section>
          ) : null}

          {template.ruleSections.length ? <RuleSectionsView rules={template.ruleSections} /> : null}

          <section className="mt-8">
            <h2 className="text-xl font-light tracking-[-0.03em]">{t("formTitle")}</h2>
            {template.fields.length ? (
              <ul className="mt-3 divide-y divide-[var(--line)]">
                {template.fields.map((field, index) => (
                  <li className="flex items-baseline justify-between gap-4 py-3" key={`${field.label}-${index}`}>
                    <span className="text-sm">
                      {field.label}
                      {field.options.length ? <span className="text-[var(--muted)]">{t("fieldOptions", { options: field.options.join(", ") })}</span> : null}
                    </span>
                    <span className="shrink-0 text-xs text-[var(--muted)]">{field.type}{field.required ? t("fieldRequired") : ""}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-sm text-[var(--muted)]">{t("noFields")}</p>}
          </section>

          {template.items.length ? (
            <section className="mt-8">
              <h2 className="text-xl font-light tracking-[-0.03em]">{template.submissionMode === "daily" ? t("checkpointsTitle") : t("itemsTitle")}</h2>
              <ol className="mt-3 space-y-2">
                {template.items.map((item, index) => (
                  <li className="text-sm" key={`${item.title}-${index}`}>
                    <span className="text-[var(--muted)]">{t("itemIndex", { index: index + 1 })}</span> {item.title}
                    {item.description ? <span className="text-[var(--muted)]">{t("itemDescription", { description: item.description })}</span> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {template.metrics.length ? (
            <section className="mt-8">
              <h2 className="text-xl font-light tracking-[-0.03em]">{t("metricsTitle")}</h2>
              <ul className="mt-3 space-y-1 text-sm">
                {template.metrics.map((metric, index) => (
                  <li key={`${metric.label}-${index}`}>{metric.label} <span className="text-[var(--muted)]">{t("metricLine", { operation: tm(`operationName.${metric.operation}`) })}</span></li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </main>
  );

  return <PublicChrome user={user} onSignIn={onSignIn}>{body}</PublicChrome>;
}
