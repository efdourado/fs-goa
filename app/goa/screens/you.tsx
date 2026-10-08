"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { LanguageSegmented } from "../SettingsMenu";
import { ThemeToggle } from "../ThemeToggle";
import type { User } from "../types";
import { BackButton, cx, UserAvatar } from "../ui";
import { CONTACT_EMAIL } from "./about";

const rowClass = "flex min-h-14 w-full cursor-pointer items-center gap-3.5 text-left text-[15px] transition hover:text-[var(--main-strong)]";
const iconClass = "h-5 w-5 flex-none text-[var(--muted)]";
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

// Round line icons, the dock's style.
const ICONS = {
  account: <svg viewBox="0 0 24 24" className={iconClass} {...stroke}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="10" r="3" /><path d="M6.6 18.2c1.2-2.2 3.1-3.3 5.4-3.3s4.2 1.1 5.4 3.3" /></svg>,
  catalog: <svg viewBox="0 0 24 24" className={iconClass} {...stroke}><circle cx="8" cy="8" r="3.5" /><circle cx="16" cy="8" r="3.5" /><circle cx="8" cy="16" r="3.5" /><circle cx="16" cy="16" r="3.5" /></svg>,
  trash: <svg viewBox="0 0 24 24" className={iconClass} {...stroke}><circle cx="12" cy="12" r="8.5" /><path d="M9 9l6 6M15 9l-6 6" /></svg>,
  about: <svg viewBox="0 0 24 24" className={iconClass} {...stroke}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></svg>,
  contact: <svg viewBox="0 0 24 24" className={iconClass} {...stroke}><path d="M12 4c4.4 0 8 2.9 8 6.6s-3.6 6.6-8 6.6c-.9 0-1.8-.1-2.6-.4L5 19l1.1-3.4C4.8 14.4 4 12.6 4 10.6 4 6.9 7.6 4 12 4Z" /></svg>,
  admin: <svg viewBox="0 0 24 24" className={iconClass} {...stroke}><path d="M12 3.5 19 6v5.5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6z" /></svg>,
  signOut: <svg viewBox="0 0 24 24" className="h-5 w-5 flex-none" {...stroke}><path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14M10 16l-4-4 4-4M6 12h9" /></svg>,
};

function Chevron() {
  return (
    <svg viewBox="0 0 16 16" className="ml-auto h-3.5 w-3.5 flex-none text-[var(--muted)]" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A labelled run of rows between hairlines — no boxes, the editorial way the rest of Goa lists things. */
function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mt-9">
      {title ? <h2 className="mb-1 text-xs font-medium text-[var(--muted)]">{title}</h2> : null}
      <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{children}</div>
    </section>
  );
}

/**
 * "Você" — the dock's last tab: who you are, then everything that used to hide in the header's
 * avatar, sliders and "⋯" menus (account, my catalogue, bin, theme, language, about,
 * contact, sign out). One page on every screen size; on a computer the avatar opens it.
 */
export function YouScreen({ user, challengeCount, groupCount, onBack, backLabel, onAccount, onCatalog, onTrash, onAbout, onLogout }: {
  user: User;
  challengeCount: number;
  groupCount: number;
  onBack: () => void;
  backLabel?: string;
  onAccount: () => void;
  onCatalog: () => void;
  onTrash: () => void;
  onAbout: () => void;
  onLogout: () => Promise<void>;
}) {
  const t = useTranslations("you");
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

      <header className="flex items-center gap-4">
        <UserAvatar name={user.name} large />
        <div className="min-w-0">
          <h1 className="truncate text-3xl font-light tracking-[-0.045em]">{user.name}</h1>
          <p className="mt-0.5 truncate text-sm text-[var(--muted)]">
            @{user.username} · {t("stats", { challenges: challengeCount, groups: groupCount })}
          </p>
        </div>
      </header>

      <Section>
        <button type="button" className={rowClass} onClick={onAccount}>{ICONS.account}{tNav("account")}<Chevron /></button>
        <button type="button" className={rowClass} onClick={onCatalog}>{ICONS.catalog}{tCatalog("title")}<Chevron /></button>
        <button type="button" className={rowClass} onClick={onTrash}>{ICONS.trash}{tTrash("personalTitle")}<Chevron /></button>
      </Section>

      <Section title={tSettings("legend")}>
        {/* The switch takes the rest of the row, both the same width so they line up. */}
        <div className="flex min-h-14 items-center gap-4 text-[15px]">
          <span className="w-20 flex-none">{tTheme("legend")}</span>
          <ThemeToggle className="ml-auto w-full max-w-[17rem]" />
        </div>
        <div className="flex min-h-14 items-center gap-4 text-[15px]">
          <span className="w-20 flex-none">{tLang("legend")}</span>
          <LanguageSegmented className="ml-auto w-full max-w-[17rem]" />
        </div>
      </Section>

      <Section title="Goa">
        <button type="button" className={rowClass} onClick={onAbout}>{ICONS.about}{tNav("about")}<Chevron /></button>
        <a className={rowClass} href={`mailto:${CONTACT_EMAIL}`}>{ICONS.contact}{tAbout("contactButton")}<Chevron /></a>
        {user.platformAdmin ? <Link className={rowClass} href="/admin">{ICONS.admin}{tNav("admin")}<Chevron /></Link> : null}
      </Section>

      <button
        type="button"
        disabled={signingOut}
        onClick={async () => { setSigningOut(true); try { await onLogout(); } finally { setSigningOut(false); } }}
        className={cx("mt-9 flex min-h-12 cursor-pointer items-center gap-3.5 text-[15px] text-[var(--danger)] transition hover:opacity-80 disabled:opacity-50")}
      >
        {ICONS.signOut}
        {signingOut ? tNav("signingOut") : tNav("signOut")}
      </button>
    </main>
  );
}
