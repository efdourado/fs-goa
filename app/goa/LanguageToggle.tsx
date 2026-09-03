"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { locales } from "@/i18n/config";
import { setUserLocale } from "@/i18n/locale";
import { cx } from "./ui";

/**
 * PT / EN switch with no menu: the two dots on the "sliders" glyph slide to
 * opposite ends on click, then the locale cookie is written and the layout
 * refreshed. One dot per language state.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const t = useTranslations("language");
  const active = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // `null` = follow the real locale; a boolean holds the target state mid-switch
  // so the dots animate before the layout refresh lands.
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const swapped = optimistic ?? active === "en";
  const target = active === "pt-BR" ? "en" : "pt-BR";

  function toggle() {
    if (pending) return;
    setOptimistic(target === "en");
    startTransition(async () => {
      await setUserLocale(target as (typeof locales)[number]);
      router.refresh();
      setOptimistic(null);
    });
  }

  const slide = { transition: "transform 440ms cubic-bezier(.5,0,.15,1)" } as const;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-label={t("switchTo", { lang: t(target) })}
      title={t(target)}
      className={cx(
        "grid h-9 w-9 cursor-pointer place-items-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--wash)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--main)]/25 disabled:opacity-60",
        className,
      )}
    >
      <svg
        viewBox="0 0 16 16"
        className="h-[18px] w-[18px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M2 4.5h12M2 11.5h12" />
        <circle cx="4" cy="4.5" r="2" fill="currentColor" stroke="none" style={{ ...slide, transform: swapped ? "translateX(8px)" : "none" }} />
        <circle cx="12" cy="11.5" r="2" fill="currentColor" stroke="none" style={{ ...slide, transform: swapped ? "translateX(-8px)" : "none" }} />
      </svg>
    </button>
  );
}
