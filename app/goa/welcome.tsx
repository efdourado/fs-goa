"use client";

import { useTranslations } from "next-intl";

import { Button, cardClass, cx, Disclosure } from "./ui";

const STEPS = ["library", "challenge", "group", "showcase"] as const;

/**
 * What a brand-new account sees on Home: one obvious way in — the guided, tap-only start — with the other
 * two ways as quiet links, and the four parts every round is built from one tap away for anyone curious.
 */
export function WelcomePanel({
  onCreateGroup,
  onQuickCreate,
  onOpenTemplates,
}: {
  onCreateGroup: () => void;
  /** The guided, tap-only way to a first challenge. */
  onQuickCreate: () => void;
  onOpenTemplates: () => void;
}) {
  const t = useTranslations("welcome");
  const link = "min-h-11 cursor-pointer font-medium text-[var(--main-strong)] underline-offset-4 hover:underline";

  return (
    <div className="max-w-2xl space-y-6">
      <section className={cx(cardClass, "p-6 sm:p-8")}>
        <h2 className="text-2xl font-light tracking-[-0.03em]">{t("starts.quick.title")}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t("starts.quick.body")}</p>
        <Button className="mt-6 min-h-12 px-6 text-base font-medium" onClick={onQuickCreate}>{t("starts.quick.cta")}</Button>
        <p className="mt-5 flex flex-wrap items-center gap-x-1 text-sm text-[var(--muted)]">
          {t("otherWays")}
          <button type="button" className={cx(link, "px-1")} onClick={onCreateGroup}>{t("starts.group.title")}</button>
          <span aria-hidden="true">·</span>
          <button type="button" className={cx(link, "px-1")} onClick={onOpenTemplates}>{t("starts.templates.title")}</button>
        </p>
      </section>

      <Disclosure summary={t("flowTitle")}>
        <ol className="grid gap-4 pb-2 pt-2 sm:grid-cols-2">
          {STEPS.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="text-2xl font-light tracking-[-0.04em] text-[var(--main)]" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <span>
                <strong className="block text-sm font-medium">{t(`steps.${step}.title`)}</strong>
                <span className="mt-0.5 block text-sm leading-6 text-[var(--muted)]">{t(`steps.${step}.body`)}</span>
              </span>
            </li>
          ))}
        </ol>
      </Disclosure>
    </div>
  );
}
