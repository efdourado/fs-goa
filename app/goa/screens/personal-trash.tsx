"use client";

import { useTranslations } from "next-intl";

import { TrashView } from "../trash-view";
import { backLinkClass, cx, PageHeading } from "../ui";

export function PersonalTrashScreen({
  csrfToken,
  onBack,
  onChanged,
}: {
  csrfToken: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("trash");
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 pb-24 sm:px-6 sm:py-12">
      <button className={cx(backLinkClass, "mb-6")} type="button" onClick={onBack}>{t("back")}</button>
      <PageHeading title={t("personalTitle")} description={t("personalSubtitle")} />
      <TrashView scope="personal" csrfToken={csrfToken} onChanged={onChanged} />
    </main>
  );
}
