"use client";

import { useTranslations } from "next-intl";

import { useLibraryName } from "./libraries";
import type { CopyResult } from "./types";
import { Button } from "./ui";

/**
 * Shown after a copy that had to leave something out: a property the destination
 * already defines under the same name-key but as something else (or removed). The copy
 * itself worked — this says exactly what was skipped and why, and nothing was reinterpreted.
 */
export function SkippedPropertiesNotice({
  skipped,
  onOpen,
}: {
  skipped: CopyResult["skippedProperties"];
  onOpen: () => void;
}) {
  const t = useTranslations("copyNotice");
  const tl = useTranslations("libraries");
  const libraryName = useLibraryName();
  const typeName = (type: string) => (tl.has(`type.${type}`) ? tl(`type.${type}`) : type);
  return (
    <div role="status" className="mt-5 rounded-2xl border border-[var(--warn)]/40 bg-[var(--warn-soft)] p-5">
      <strong className="block text-sm">{t("title", { count: skipped.length })}</strong>
      <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("body")}</p>
      <ul className="mt-3 space-y-1.5 text-sm leading-6">
        {skipped.map((property) => (
          <li key={`${property.library.kind}:${property.key}`}>
            {property.reason === "archived"
              ? t("archived", { property: property.label, library: libraryName(property.library) })
              : t("typeMismatch", {
                  property: property.label,
                  library: libraryName(property.library),
                  type: typeName(property.type),
                  existing: typeName(property.existingType ?? ""),
                })}
          </li>
        ))}
      </ul>
      <div className="mt-4"><Button onClick={onOpen}>{t("open")}</Button></div>
    </div>
  );
}
