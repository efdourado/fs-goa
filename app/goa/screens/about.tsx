"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { BackButton, PageHeading } from "../ui";

interface Point { title: string; body: string }

/** One section of the page: a small heading and whatever it holds. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-xl font-light tracking-[-0.02em]">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * About Goa — scannable, not an essay: three steps, a few feature cards, the ranking in three lines and some
 * quick facts. Every line is short on purpose.
 */
export function AboutScreen({ onBack, backLabel }: { onBack: () => void; backLabel?: string }) {
  const t = useTranslations("about");
  const steps = t.raw("steps") as Point[];
  const features = t.raw("features") as Point[];
  const ranking = t.raw("ranking") as string[];
  const facts = t.raw("facts") as string[];
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <BackButton onClick={onBack} label={backLabel ?? t("back")} className="mb-6" />
      <PageHeading title={t("title")} description={t("lede")} />

      <Section title={t("stepsTitle")}>
        <ol className="grid gap-3 sm:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="rounded-2xl bg-[var(--wash)] p-4">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--main-soft)] text-xs font-medium text-[var(--main-strong)]">{index + 1}</span>
              <p className="mt-3 font-medium">{step.title}</p>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section title={t("featuresTitle")}>
        <ul className="grid gap-3 sm:grid-cols-2">
          {features.map((feature) => (
            <li key={feature.title} className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4">
              <p className="font-medium">{feature.title}</p>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{feature.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("rankingTitle")}>
        <ul className="space-y-3">
          {ranking.map((line) => (
            <li key={line} className="flex gap-3 text-[15px] leading-7">
              <span aria-hidden="true" className="mt-[11px] h-1.5 w-1.5 flex-none rounded-full bg-[var(--main)]" />
              {line}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("factsTitle")}>
        <ul className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {facts.map((fact) => <li key={fact} className="py-3 text-[15px] leading-6">{fact}</li>)}
        </ul>
      </Section>

      <footer className="mt-12 space-y-2 text-sm text-[var(--muted)]">
        <p>{t("byline")}</p>
        <p>
          {t("feedbackNudge")}{" "}
          <Link href="/feedback" className="underline underline-offset-4 hover:text-[var(--ink)]">{t("feedbackLink")}</Link>
        </p>
      </footer>
    </main>
  );
}
