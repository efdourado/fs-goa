import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Footer } from "@/app/goa/Footer";
import { SettingsMenu } from "@/app/goa/SettingsMenu";
import { Brand } from "@/app/goa/ui";

export const runtime = "nodejs";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("about");
  return { title: `${t("title")} · Goa`, description: t("lede") };
}

export default async function AboutPage() {
  const t = await getTranslations("about");
  const paragraphs = t.raw("body") as string[];

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <header className="border-b border-[var(--edge)] bg-[var(--canvas)]/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:h-[76px] sm:px-6">
          <Link href="/" className="rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25"><Brand /></Link>
          <SettingsMenu />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">{t("title")}</h1>
        <p className="mt-4 text-lg leading-8 text-[var(--muted)]">{t("lede")}</p>
        <div className="mt-8 space-y-5 text-base leading-8">
          {paragraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
        <p className="mt-10 text-sm text-[var(--muted)]">
          {t("feedbackNudge")}{" "}
          <Link href="/feedback" className="underline underline-offset-4 hover:text-[var(--ink)]">
            {t("feedbackLink")}
          </Link>
        </p>
      </main>
      <Footer />
    </div>
  );
}
