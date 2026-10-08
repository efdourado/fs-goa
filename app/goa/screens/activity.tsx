"use client";

import { useTranslations } from "next-intl";

import type { Id, MemberRequest } from "../types";
import { BackButton, NotificationList, PageHeading } from "../ui";

/** "Novidades" as a page — the dock's inbox tab; the same list the header's bell opens on a computer. */
export function ActivityScreen({ notifications, onBack, backLabel, onAcceptRequest, onDeclineRequest }: {
  notifications: MemberRequest[];
  onBack: () => void;
  backLabel?: string;
  onAcceptRequest: (id: Id) => Promise<void>;
  onDeclineRequest: (id: Id) => Promise<void>;
}) {
  const t = useTranslations("notifications");
  const tNav = useTranslations("nav");
  const count = notifications.length;
  return (
    <main className="mx-auto max-w-xl px-4 py-6 pb-24 sm:px-6 sm:py-12">
      <BackButton onClick={onBack} label={backLabel ?? tNav("home")} className="mb-6 hidden sm:inline-flex" />
      <PageHeading title={t("title")} description={count ? t("pending", { count }) : undefined} />
      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper)]">
        <NotificationList notifications={notifications} onAcceptRequest={onAcceptRequest} onDeclineRequest={onDeclineRequest} />
      </div>
    </main>
  );
}
