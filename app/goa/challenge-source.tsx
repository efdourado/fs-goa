"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { type CatalogScope, LibraryPills, libraryChoices, useCatalogLibraries } from "./libraries";
import { NewLibraryDialog } from "./library-dialogs";
import type { ChallengeLibrary } from "./challenge-creation";
import { Field, SelectableCards, StatusMessage, Toggle } from "./ui";

/** Recording frequency is a challenge-level choice; either mode can use library items. */
export function ChallengeSource({ scope, linked, libraryKind, dated, onLinked, onLibrary, onDated }: {
  scope: CatalogScope; linked: boolean; libraryKind: string | null; dated: boolean;
  onLinked: (linked: boolean) => void; onLibrary: (library: ChallengeLibrary) => void; onDated: (dated: boolean) => void;
}) {
  const t = useTranslations("challengeCreate");
  const { data, error, reload } = useCatalogLibraries(scope);
  const [creating, setCreating] = useState(false);
  return <div className="space-y-4">
    <Field plain label={t("modeQuestion")}>
      <SelectableCards value={dated ? "daily" : "list"} onChange={(mode) => { onDated(mode === "daily"); if (mode === "list") onLinked(true); else if (!libraryKind) onLinked(false); }} options={[
        { value: "list", label: t("list"), hint: t("listHint") },
        { value: "daily", label: t("daily"), hint: t("dailyHint") },
      ]} />
    </Field>
    {dated ? <Toggle checked={linked} onChange={onLinked} label={t("useLibrary")} hint={t("useLibraryHint")} /> : null}
    {linked ? <Field plain label={t("library")} hint={t(dated ? "dailyLibraryHint" : "listLibraryHint")}>
      <LibraryPills choices={libraryChoices(data ?? [])} kind={libraryKind} label={t("library")} onPick={onLibrary} onNew={() => setCreating(true)} />
      {data === null && !error ? <p className="mt-2 text-xs text-[var(--muted)]">{t("loadingLibraries")}</p> : null}
      <StatusMessage error={error} />
    </Field> : null}
    {creating ? <NewLibraryDialog scope={scope} onCancel={() => setCreating(false)} onCreated={(made) => { reload(); onLibrary(made); setCreating(false); }} /> : null}
  </div>;
}
