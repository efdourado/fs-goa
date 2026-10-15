"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { createPortal } from "react-dom";

import type { ChallengeDetail, Entry, Id } from "../types";
import { ExportDocument } from "./export-document";
import { exportDisplay, exportFontClass } from "./fonts";
import "./export.css";

/**
 * The PDF log in a large window over the challenge: the same document as its own page, closed with its
 * button, Esc or a click on the backdrop, back exactly where you were. While it's open the tab is titled like the file (Chrome names the PDF after
 * it), the page behind doesn't scroll, and printing prints only the document (export.css).
 */
export function ExportModal({ challenge, entries, userId, onClose }: { challenge: ChallengeDetail; entries: Entry[]; userId: Id; onClose: () => void }) {
  const t = useTranslations("exportDoc");
  const tc = useTranslations("common");
  useEffect(() => {
    const root = document.documentElement;
    const title = document.title;
    const overflow = document.body.style.overflow;
    root.classList.add("xd-modal-open");
    document.title = t("fileTitle", { title: challenge.title });
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      root.classList.remove("xd-modal-open");
      document.title = title;
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [challenge.title, onClose, t]);
  return createPortal(
    <div className="xd-modal fixed inset-0 z-[90] flex items-center justify-center p-2 sm:p-6">
      {/* The dimmed backdrop is itself a way out: a click on it closes (the window's button and Esc do too). */}
      <button type="button" tabIndex={-1} aria-label={tc("close")} onClick={onClose} className="xd-modal-backdrop absolute inset-0 cursor-default bg-black/45 backdrop-blur-[2px]" />
      <div
        className="xd-modal-panel relative h-full max-h-[calc(100dvh-1rem)] w-full max-w-[1120px] overflow-hidden rounded-[24px] bg-[var(--canvas)] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.5)] sm:max-h-[calc(100dvh-3rem)]"
        role="dialog"
        aria-modal="true"
        aria-label={t("fileTitle", { title: challenge.title })}
      >
        <ExportDocument challenge={challenge} entries={entries} userId={userId} fontClassName={exportFontClass} displayFont={exportDisplay.style.fontFamily} onClose={onClose} />
      </div>
    </div>,
    document.body,
  );
}
