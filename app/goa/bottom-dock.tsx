"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import type { ParticipantTab, Screen } from "./types";
import { cx } from "./ui";

export type DockTab = "home" | "templates" | "activity" | "you";

/**
 * Which dock tab a screen belongs to — the tab that stays lit while you're anywhere under it. `null` hides
 * the dock: inside a challenge (it has its own Today / Group / Result bar) and on the shells around sign-in.
 */
export function dockTabFor(screen: Screen): DockTab | null {
  switch (screen.kind) {
    case "dashboard":
    case "group":
    case "group-catalog":
    case "catalog-item":
    case "group-trash":
    case "create-challenge":
    case "create-personal-challenge":
    case "quick-create":
    case "invite":
    case "invite-success":
      return "home";
    case "templates":
    case "template":
      return "templates";
    case "activity":
      return "activity";
    case "you":
    case "account":
    case "personal-trash":
    case "personal-catalog":
    case "personal-catalog-item":
    case "about":
      return "you";
    case "challenge":
    case "admin":
    case "loading":
    case "auth":
    case "account-deactivated":
      return null;
  }
}

const icon = "h-[22px] w-[22px]";
const ICONS: Record<DockTab, ReactNode> = {
  // Home: a progress ring, what Goa is about.
  home: <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" opacity="0.35" /><path d="M12 3.5a8.5 8.5 0 0 1 8.2 10.7" strokeWidth="2.2" /><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" /></svg>,
  // Templates: a little gallery of round choices.
  templates: <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="7.75" cy="7.75" r="3.25" /><circle cx="16.25" cy="7.75" r="3.25" /><circle cx="7.75" cy="16.25" r="3.25" /><circle cx="16.25" cy="16.25" r="3.25" /></svg>,
  activity: <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></svg>,
  // You: a person in a circle.
  you: <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="10" r="3" /><path d="M6.6 18.2c1.2-2.2 3.1-3.3 5.4-3.3s4.2 1.1 5.4 3.3" /></svg>,
};

/** The floating pill both docks share: at the thumb, above the home indicator, phones only. */
const dockClass = "fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-40 grid h-16 rounded-[2rem] border border-[var(--edge)] bg-[var(--paper)]/95 px-1.5 shadow-[0_10px_30px_-10px_rgba(20,24,20,0.35)] backdrop-blur-xl sm:hidden";
const tabClass = (on: boolean) => cx(
  "relative my-1.5 flex cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[1.6rem] text-[10.5px] transition",
  on ? "bg-[var(--main-soft)] font-medium text-[var(--main-strong)]" : "text-[var(--muted)] hover:text-[var(--ink)]",
);

/**
 * The phone's one navigation: a floating dock at the thumb with Home, Templates, Updates and You. It replaces
 * the header's avatar, bell, sliders and "⋯" on small screens; from `sm:` up the header keeps its links.
 */
export function BottomDock({ active, notificationCount, onSelect }: {
  active: DockTab;
  notificationCount: number;
  onSelect: (tab: DockTab) => void;
}) {
  const t = useTranslations("nav");
  const tNotify = useTranslations("notifications");
  const labels: Record<DockTab, string> = { home: t("home"), templates: t("templates"), activity: tNotify("label"), you: t("you") };
  return (
    <nav aria-label={t("dockAria")} className={cx(dockClass, "grid-cols-4")}>
      {(["home", "templates", "activity", "you"] as const).map((tab) => {
        const on = tab === active;
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onSelect(tab)}
            aria-current={on ? "page" : undefined}
            aria-label={tab === "activity" && notificationCount ? tNotify("labelCount", { count: notificationCount }) : undefined}
            className={tabClass(on)}
          >
            {ICONS[tab]}
            {tab === "activity" && notificationCount ? (
              <span className="absolute left-1/2 top-1 ml-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--main)] px-1 text-[10px] font-black leading-none text-white" aria-hidden="true">
                {notificationCount > 9 ? "9+" : notificationCount}
              </span>
            ) : null}
            {labels[tab]}
          </button>
        );
      })}
    </nav>
  );
}

const TAB_ICONS: Record<ParticipantTab, ReactNode> = {
  today: <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></svg>,
  grupo: <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="9" cy="9" r="3.2" /><circle cx="16.5" cy="10" r="2.6" /><path d="M3.5 19c.8-3.2 3-4.8 5.5-4.8s4.7 1.6 5.5 4.8M14.5 15c2.6-.4 4.9.9 6 4" /></svg>,
  results: <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M5 20v-6M10 20V9M15 20v-8M20 20V4" /></svg>,
};

/**
 * Inside a challenge the same dock carries the way out (‹, to the challenge's group or Home) and the
 * challenge's own tabs — Today, Group, Result — so a phone has one navigation in one place.
 */
export function ChallengeDock({ tabs, active, onTab, onBack, backLabel, label, tabLabel }: {
  tabs: ParticipantTab[];
  active: ParticipantTab;
  onTab: (tab: ParticipantTab) => void;
  onBack: () => void;
  /** Where ‹ leads, said out loud: "Back to Cineclube". */
  backLabel: string;
  label: string;
  tabLabel: (tab: ParticipantTab) => string;
}) {
  return (
    <nav aria-label={label} className={dockClass} style={{ gridTemplateColumns: `3.25rem repeat(${tabs.length}, minmax(0, 1fr))` }}>
      <button type="button" onClick={onBack} aria-label={backLabel} title={backLabel} className="my-3.5 mr-1.5 grid cursor-pointer place-items-center border-r border-[var(--line)] text-[var(--muted)] transition hover:text-[var(--ink)]">
        <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5" /></svg>
      </button>
      {tabs.map((tab) => (
        <button key={tab} type="button" onClick={() => onTab(tab)} aria-current={tab === active ? "page" : undefined} className={tabClass(tab === active)}>
          {TAB_ICONS[tab]}
          {tabLabel(tab)}
        </button>
      ))}
    </nav>
  );
}
