import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { FeedbackForm } from "@/app/goa/FeedbackForm";
import { SettingsMenu } from "@/app/goa/SettingsMenu";
import { Brand } from "@/app/goa/ui";

export const runtime = "nodejs";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("feedbackPage");
  return { title: `${t("title")} · Goa`, description: t("lede") };
}

export default async function FeedbackPage() {
  const t = await getTranslations("feedbackPage");
  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <header className="border-b border-[var(--edge)] bg-[var(--canvas)]/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4 sm:h-[76px] sm:px-6">
          <Link href="/" className="rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25"><Brand /></Link>
          <SettingsMenu />
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">{t("title")}</h1>
        <p className="mt-3 text-base leading-7 text-[var(--muted)]">{t("lede")}</p>
        <div className="mt-8">
          <FeedbackForm />
        </div>
      </main>
    </div>
  );
}
