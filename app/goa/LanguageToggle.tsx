"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { locales } from "@/i18n/config";
import { setUserLocale } from "@/i18n/locale";
import { cx } from "./ui";

/**
 * PT / EN switch. Writes the locale cookie via a server action, then refreshes so
 * the layout re-renders with the new catalog.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const t = useTranslations("language");
  const active = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: string) {
    if (next === active || pending) return;
    startTransition(async () => {
      await setUserLocale(next as (typeof locales)[number]);
      router.refresh();
    });
  }

  return (
    <div
      className={cx("inline-flex gap-0.5 rounded-lg bg-[var(--wash)] p-0.5", className)}
      role="group"
      aria-label={t("legend")}
    >
      {locales.map((value) => {
        const isActive = active === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => choose(value)}
            disabled={pending}
            aria-pressed={isActive}
            title={t(value)}
            className={cx(
              "h-7 cursor-pointer rounded-md px-2.5 text-xs font-semibold transition disabled:cursor-progress",
              isActive
                ? "bg-[var(--paper)] text-[var(--ink)] shadow-[var(--elevate-1)]"
                : "text-[var(--muted)] hover:text-[var(--ink)]",
            )}
          >
            {value === "pt-BR" ? "PT" : "EN"}
            <span className="sr-only"> · {t(value)}</span>
          </button>
        );
      })}
    </div>
  );
}
