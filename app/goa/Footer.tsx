"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export function Footer() {
  const t = useTranslations("footer");
  const linkClass = "hover:text-[var(--ink)] transition";
  return (
    <footer className="mt-16 border-t border-[var(--line)] px-4 py-8 text-sm text-[var(--muted)] sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p>{t("tagline")}</p>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link className={linkClass} href="/sobre">{t("about")}</Link>
          <Link className={linkClass} href="/modelos">{t("templates")}</Link>
          <Link className={linkClass} href="/feedback">{t("feedback")}</Link>
          <a className={linkClass} href="https://instagram.com/efdourado" target="_blank" rel="noreferrer">
            @efdourado
          </a>
        </nav>
      </div>
    </footer>
  );
}
