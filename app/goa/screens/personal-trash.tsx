"use client";

import { useTranslations } from "next-intl";

import { TrashView } from "../trash-view";
import { BackButton, PageHeading } from "../ui";

export function PersonalTrashScreen({
  csrfToken,
  onBack,
  backLabel,
  onChanged,
}: {
  csrfToken: string;
  onBack: () => void;
  /** What the button says — the parent screen's name; falls back to plain "Back". */
  backLabel?: string;
  onChanged: () => void;
}) {
  const t = useTranslations("trash");
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <BackButton onClick={onBack} label={backLabel ?? t("back")} className="mb-6" />
      <PageHeading title={t("personalTitle")} description={t("personalSubtitle")} />
      <TrashView scope="personal" csrfToken={csrfToken} onChanged={onChanged} />
    </main>
  );
}
