"use client";

import { useTranslations } from "next-intl";

import { LibraryPills, libraryChoices, useLibraryName } from "./libraries";
import { StateButton } from "./state-button";
import type { CatalogLibrary, ChallengeLibraryRef, LibraryPick } from "./types";
import { choicePillClass, cx, Field } from "./ui";

/**
 * Where a copy's items go, always asked: the destination's own libraries as pills, like creating a challenge by hand
 * (no "new library" here, a dialog can't open inside the copy dialog). A destination with no library at all is offered
 * the source's one, tagged as the suggestion; it's made only when the copy is.
 */
export function LibraryChoiceField({ origin, libraries, value, onChange }: {
  origin: Omit<ChallengeLibraryRef, "id">;
  /** The destination's libraries; null while they load. */
  libraries: CatalogLibrary[] | null;
  value: LibraryPick | null;
  onChange: (pick: LibraryPick) => void;
}) {
  const t = useTranslations("libraryChoice");
  const libraryName = useLibraryName();
  if (libraries === null) {
    return <Field plain label={t("label")}><p className="text-xs text-[var(--muted)]">{t("loading")}</p></Field>;
  }
  if (!libraries.length) {
    const active = Boolean(value && "suggested" in value);
    return (
      <Field plain label={t("label")} hint={t("suggestionHint")}>
        <div className="flex flex-wrap gap-2">
          <StateButton type="button" aria-pressed={active} onClick={() => onChange({ suggested: true })} className={choicePillClass({ active, dashed: !active })}>
            {libraryName(origin)}
            <span className={cx("rounded-full px-2.5 py-0.5 text-[11px] font-medium", active ? "bg-white/20 text-white" : "bg-[var(--main)] text-white")}>
              {t("suggestion")}
            </span>
          </StateButton>
        </div>
      </Field>
    );
  }
  const picked = value && "libraryId" in value ? libraries.find((library) => library.id === value.libraryId)?.kind ?? null : null;
  return (
    <Field plain label={t("label")}>
      <LibraryPills
        label={t("label")}
        choices={libraryChoices(libraries)}
        kind={picked}
        onPick={(choice) => { if (choice.id) onChange({ libraryId: choice.id }); }}
      />
    </Field>
  );
}
