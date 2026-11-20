"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { type CatalogScope, LibraryPills, libraryChoices, type useCatalogLibraries } from "./libraries";
import { LibraryPropertiesDialog, NewLibraryDialog } from "./library-dialogs";
import type { ChallengeLibrary } from "./challenge-creation";
import type { CatalogLibrary } from "./types";
import { Field, SelectableCards, StatusMessage, Toggle } from "./ui";

/** Recording frequency is a challenge-level choice; either mode can use library items. */
export function ChallengeSource({ scope, libraries, linked, libraryKind, dated, onLinked, onLibrary, onDated, onLibraryCleared, onLibraryDeleted }: {
  scope: CatalogScope; linked: boolean; libraryKind: string | null; dated: boolean;
  libraries: ReturnType<typeof useCatalogLibraries>;
  onLinked: (linked: boolean) => void; onLibrary: (library: ChallengeLibrary) => void; onDated: (dated: boolean) => void;
  onLibraryCleared?: () => void;
  onLibraryDeleted?: (library: CatalogLibrary) => void;
}) {
  const t = useTranslations("challengeCreate");
  const tl = useTranslations("libraries");
  const { data, error, reload } = libraries;
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CatalogLibrary | null>(null);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const availableLibraries = (data ?? []).filter((library) => !deletedIds.includes(library.id));
  const editedLibrary = editing && (data?.find((library) => library.id === editing.id) ?? editing);

  return <div className="space-y-4">
    <Field plain label={t("modeQuestion")}>
      <SelectableCards value={dated ? "daily" : "list"} onChange={(mode) => { onDated(mode === "daily"); if (mode === "list") onLinked(true); else if (!libraryKind) onLinked(false); }} options={[
        { value: "list", label: t("list"), hint: t("listHint") },
        { value: "daily", label: t("daily"), hint: t("dailyHint") },
      ]} />
    </Field>
    {dated ? <Toggle checked={linked} onChange={onLinked} label={t("useLibrary")} hint={t("useLibraryHint")} /> : null}
    {linked ? <Field plain label={t("library")} hint={t(dated ? "dailyLibraryHint" : "listLibraryHint")}>
      <LibraryPills choices={libraryChoices(availableLibraries)} kind={libraryKind} label={t("library")} onPick={onLibrary} onUnpick={onLibraryCleared} onNew={() => setCreating(true)}
        onEdit={onLibraryDeleted ? (id) => setEditing(availableLibraries.find((library) => library.id === id) ?? null) : undefined} />
      {data === null && !error ? <p className="mt-2 text-xs text-[var(--muted)]">{t("loadingLibraries")}</p> : null}
      <StatusMessage error={error} />
    </Field> : null}
    <StatusMessage success={notice} />
    {creating ? <NewLibraryDialog scope={scope} onCancel={() => setCreating(false)} onCreated={(made) => { reload(); onLibrary(made); setCreating(false); }} /> : null}
    {editedLibrary ? <LibraryPropertiesDialog scope={scope} library={editedLibrary} canEdit onClose={() => setEditing(null)}
      onChanged={reload}
      onDeleted={onLibraryDeleted ? (name) => {
        setDeletedIds((current) => [...current, editedLibrary.id]);
        setEditing(null);
        onLibraryDeleted(editedLibrary);
        setNotice(tl("deleted", { name }));
        reload();
      } : undefined} /> : null}
  </div>;
}
