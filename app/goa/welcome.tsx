"use client";

import { useTranslations } from "next-intl";

import { type RecipeIconName, RecipeIcon } from "./recipe-icons";
import { Button, cardClass, cx } from "./ui";

const STEPS = ["library", "challenge", "group", "showcase"] as const;
const RECIPES: RecipeIconName[] = ["cinema", "bookshelf", "library", "habit", "tables", "custom"];

/**
 * What a brand-new account sees on Home instead of a bare "create a group": the four parts every round
 * is built from, the recipes a challenge starts from, and three real ways in.
 */
export function WelcomePanel({
  onCreateGroup,
  onQuickCreate,
  onOpenTemplates,
}: {
  onCreateGroup: () => void;
  /** The guided, tap-only way to a first challenge — replaces what used to be a straight line to the full wizard. */
  onQuickCreate: () => void;
  onOpenTemplates: () => void;
}) {
  const t = useTranslations("welcome");
  const tr = useTranslations("createChallenge");
  const starts = [
    { key: "quick", onClick: onQuickCreate, primary: true },
    { key: "group", onClick: onCreateGroup, primary: false },
    { key: "templates", onClick: onOpenTemplates, primary: false },
  ] as const;

  return (
    <div className="space-y-14">
      <section aria-labelledby="welcome-flow">
        <h2 id="welcome-flow" className="text-xl font-light">{t("flowTitle")}</h2>
        <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <li key={step} className={cx(cardClass, "relative p-5")}>
              <span className="text-3xl font-light tracking-[-0.04em] text-[var(--main)]" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <strong className="mt-3 block text-lg font-medium tracking-[-0.02em]">{t(`steps.${step}.title`)}</strong>
              <span className="mt-1.5 block text-sm leading-6 text-[var(--muted)]">{t(`steps.${step}.body`)}</span>
              {index < STEPS.length - 1 ? (
                <svg viewBox="0 0 16 16" className="absolute -right-[13px] top-1/2 hidden h-[10px] w-[10px] -translate-y-1/2 text-[var(--muted)] lg:block" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <path d="M5.5 3.5 10 8l-4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs text-[var(--muted)]">{t("recipesTitle")}</span>
          {RECIPES.map((recipe) => (
            <span key={recipe} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--paper)] px-3.5 text-sm font-light">
              <RecipeIcon name={recipe} className="h-4 w-4 text-[var(--main)]" />
              {tr(`recipes.${recipe}.name`)}
            </span>
          ))}
        </div>
      </section>

      <section aria-labelledby="welcome-start">
        <h2 id="welcome-start" className="text-xl font-light">{t("startTitle")}</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {starts.map((entry) => (
            <div key={entry.key} className={cx(cardClass, "flex flex-col p-5 sm:p-6")}>
              <strong className="text-lg font-medium tracking-[-0.02em]">{t(`starts.${entry.key}.title`)}</strong>
              <p className="mt-1.5 flex-1 text-sm leading-6 text-[var(--muted)]">{t(`starts.${entry.key}.body`)}</p>
              <Button variant={entry.primary ? "primary" : "secondary"} className="mt-5 self-start" onClick={entry.onClick}>
                {t(`starts.${entry.key}.cta`)}
              </Button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
