"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { backLinkClass, cx, PageHeading } from "../ui";

export function AboutScreen({ onBack }: { onBack: () => void }) {
  const t = useTranslations("about");
  const paragraphs = t.raw("body") as string[];
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <button className={cx(backLinkClass, "mb-6")} type="button" onClick={onBack}>{t("back")}</button>
      <PageHeading title={t("title")} description={t("lede")} />
      <div className="mt-8 space-y-5 text-base leading-8">
        {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      </div>
      <p className="mt-10 text-sm text-[var(--muted)]">
        {t("feedbackNudge")}{" "}
        <Link href="/feedback" className="underline underline-offset-4 hover:text-[var(--ink)]">
          {t("feedbackLink")}
        </Link>
      </p>
    </main>
  );
}
