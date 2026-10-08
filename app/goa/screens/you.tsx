"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { LanguageSegmented } from "../SettingsMenu";
import { ThemeToggle } from "../ThemeToggle";
import type { User } from "../types";
import { BackButton, cx, UserAvatar } from "../ui";
import { CONTACT_EMAIL } from "./about";

const rowClass = "flex min-h-[52px] w-full cursor-pointer items-center gap-3 px-4 text-left text-[15px] transition hover:bg-[var(--wash)]";

function Chevron() {
  return (
    <svg viewBox="0 0 16 16" className="ml-auto h-3.5 w-3.5 flex-none text-[var(--muted)]" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A rounded group of rows, like iOS Settings: one border, hairlines between. */
function Group({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-[var(--line)] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper)]">{children}</div>;
}

/**
 * "Você" — the dock's last tab: who you are, then everything that used to hide in the header's
 * avatar, sliders and "⋯" menus (account, my catalogue, bin, theme, language, about,
 * contact, sign out). One page on every screen size; on a computer the avatar opens it.
 */
export function YouScreen({ user, onBack, backLabel, onAccount, onCatalog, onTrash, onAbout, onLogout }: {
  user: User;
  onBack: () => void;
  backLabel?: string;
  onAccount: () => void;
  onCatalog: () => void;
  onTrash: () => void;
  onAbout: () => void;
  onLogout: () => Promise<void>;
}) {
  const tNav = useTranslations("nav");
  const tSettings = useTranslations("settings");
  const tTheme = useTranslations("theme");
  const tLang = useTranslations("language");
  const tCatalog = useTranslations("personalCatalog");
  const tTrash = useTranslations("trash");
  const tAbout = useTranslations("about");
  const [signingOut, setSigningOut] = useState(false);

  return (
    <main className="mx-auto max-w-xl px-4 py-6 pb-24 sm:px-6 sm:py-12">
      {/* On a phone the dock is the way back; a computer has no dock, so it keeps the button. */}
      <BackButton onClick={onBack} label={backLabel ?? tNav("home")} className="mb-6 hidden sm:inline-flex" />
      <button type="button" onClick={onAccount} className="flex w-full cursor-pointer items-center gap-4 rounded-2xl p-1 text-left transition hover:bg-[var(--wash)]">
        <UserAvatar name={user.name} large />
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-2xl font-medium tracking-[-0.04em]">{user.name}</strong>
          <span className="block truncate text-sm text-[var(--muted)]">@{user.username}</span>
        </span>
        <Chevron />
      </button>

      <div className="mt-7 space-y-4">
        <Group>
          <button type="button" className={rowClass} onClick={onAccount}>{tNav("account")}<Chevron /></button>
          <button type="button" className={rowClass} onClick={onCatalog}>{tCatalog("title")}<Chevron /></button>
          <button type="button" className={rowClass} onClick={onTrash}>{tTrash("personalTitle")}<Chevron /></button>
        </Group>

        <section>
          <h2 className="mb-2 px-1 text-xs font-medium text-[var(--muted)]">{tSettings("legend")}</h2>
          <Group>
            <div className="space-y-2 px-4 py-3">
              <p className="text-sm">{tTheme("legend")}</p>
              <ThemeToggle />
            </div>
            <div className="space-y-2 px-4 py-3">
              <p className="text-sm">{tLang("legend")}</p>
              <LanguageSegmented />
            </div>
          </Group>
        </section>

        <Group>
          <button type="button" className={rowClass} onClick={onAbout}>{tNav("about")}<Chevron /></button>
          <a className={rowClass} href={`mailto:${CONTACT_EMAIL}`}>{tAbout("contactButton")}<Chevron /></a>
          {user.platformAdmin ? <Link className={rowClass} href="/admin">{tNav("admin")}<Chevron /></Link> : null}
        </Group>

        <button
          type="button"
          disabled={signingOut}
          onClick={async () => { setSigningOut(true); try { await onLogout(); } finally { setSigningOut(false); } }}
          className={cx("min-h-12 w-full cursor-pointer rounded-2xl text-[15px] text-[var(--danger)] transition hover:bg-[var(--danger-soft)] disabled:opacity-50")}
        >
          {signingOut ? tNav("signingOut") : tNav("signOut")}
        </button>
      </div>
    </main>
  );
}
