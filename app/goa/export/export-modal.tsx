"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { createPortal } from "react-dom";

import type { ChallengeDetail, Entry, Id } from "../types";
import { ExportDocument } from "./export-document";
import { exportDisplay, exportFontClass } from "./fonts";
import "./export.css";

/**
 * The PDF log over the challenge, the whole screen: the same document as its own page, closed with × or Esc,
 * back exactly where you were. While it's open the tab is titled like the file (Chrome names the PDF after
 * it), the page behind doesn't scroll, and printing prints only the document (export.css).
 */
export function ExportModal({ challenge, entries, userId, onClose }: { challenge: ChallengeDetail; entries: Entry[]; userId: Id; onClose: () => void }) {
  const t = useTranslations("exportDoc");
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
    <div className="xd-modal fixed inset-0 z-[90] overflow-y-auto overscroll-contain" role="dialog" aria-modal="true" aria-label={t("fileTitle", { title: challenge.title })}>
      <ExportDocument challenge={challenge} entries={entries} userId={userId} fontClassName={exportFontClass} displayFont={exportDisplay.style.fontFamily} onClose={onClose} />
    </div>,
    document.body,
  );
}
