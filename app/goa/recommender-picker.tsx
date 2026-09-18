"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { API_PATHS, apiRequest } from "./api";
import { useCsrf } from "./csrf";
import { useGoaFormat } from "./format";
import { type CatalogScope, useCatalogRecommenders } from "./libraries";
import type { CatalogRecommender, Id, Member, RecommenderRef } from "./types";
import { Button, inputClass } from "./ui";

/** Who an item came from — nobody in particular, a member, a saved outside name, or a free note. */
export type RecommenderValue =
  | { kind: "none" }
  | { kind: "member"; userId: Id }
  | { kind: "external"; recommenderId: Id }
  | { kind: "note"; text: string };

export const NO_RECOMMENDER: RecommenderValue = { kind: "none" };

export function recommenderFromItem(ref: RecommenderRef | null | undefined, originNote?: string | null): RecommenderValue {
  if (ref?.kind === "member") return { kind: "member", userId: ref.id };
  if (ref?.kind === "external") return { kind: "external", recommenderId: ref.id };
  if (originNote?.trim()) return { kind: "note", text: originNote.trim() };
  return NO_RECOMMENDER;
}

export function sameRecommender(a: RecommenderValue, b: RecommenderValue): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "member" && b.kind === "member") return a.userId === b.userId;
  if (a.kind === "external" && b.kind === "external") return a.recommenderId === b.recommenderId;
  if (a.kind === "note" && b.kind === "note") return a.text.trim() === b.text.trim();
  return true;
}

/**
 * The request keys for a recommender. `clearOthers` sends all three (blank for
 * the two not chosen) — needed on an edit, where a missing key means "leave it
 * alone" and only an explicit blank actually clears the old one. A brand-new
 * item sends only what it has.
 */
export function recommenderBody(
  value: RecommenderValue,
  keys: "item" | "catalog",
  clearOthers: boolean,
): Record<string, string> {
  const names = keys === "item"
    ? { user: "recommendedByUserId", external: "recommendedByExternalId", note: "originNote" }
    : { user: "catalogRecommendedByUserId", external: "catalogRecommendedByExternalId", note: "catalogOriginNote" };
  const body: Record<string, string> = {};
  if (value.kind === "member") body[names.user] = value.userId;
  else if (value.kind === "external") body[names.external] = value.recommenderId;
  else if (value.kind === "note" && value.text.trim()) body[names.note] = value.text.trim();
  if (clearOthers) {
    for (const key of [names.user, names.external, names.note]) if (!(key in body)) body[key] = "";
  }
  return body;
}

/** The saved outside names of one space, plus a way to add one — shared by every picker on a screen. */
export function useRecommenderSource(scope: CatalogScope, enabled: boolean) {
  const csrf = useCsrf();
  const { data, reload } = useCatalogRecommenders(scope, enabled);
  const [created, setCreated] = useState<CatalogRecommender[]>([]);
  const list = [...(data ?? []), ...created.filter((extra) => !(data ?? []).some((known) => known.id === extra.id))]
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const create = useCallback(async (displayName: string): Promise<CatalogRecommender> => {
    const made = await apiRequest<CatalogRecommender>(API_PATHS.catalogWorkspace(scope).recommenders, {
      method: "POST", body: { displayName }, csrfToken: csrf,
    });
    setCreated((current) => [...current, made]);
    reload();
    return made;
  }, [scope, csrf, reload]);
  return { recommenders: list, create };
}

export type RecommenderSource = ReturnType<typeof useRecommenderSource>;

const NEW = "__new__";
const NOTE = "__note__";

/**
 * "Recommended by" — one control for the four ways an item can arrive: nobody
 * in particular, a group member, someone outside the group (saved by name so
 * they can be picked again), or a free-form note. Only one can apply at a time,
 * which is why this is a single select rather than four fields.
 */
export function RecommenderPicker({
  value,
  onChange,
  members,
  source,
  compact = false,
  disabled = false,
}: {
  value: RecommenderValue;
  onChange: (next: RecommenderValue) => void;
  members: Member[];
  source: RecommenderSource;
  /** Just the control — for a dense row that already has its own label. */
  compact?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("recommenders");
  const f = useGoaFormat();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectValue = adding ? NEW
    : value.kind === "member" ? `m:${value.userId}`
    : value.kind === "external" ? `e:${value.recommenderId}`
    : value.kind === "note" ? NOTE
    : "";

  function pick(raw: string) {
    setError(null);
    if (raw === NEW) { setAdding(true); return; }
    setAdding(false);
    if (raw === NOTE) onChange({ kind: "note", text: value.kind === "note" ? value.text : "" });
    else if (raw.startsWith("m:")) onChange({ kind: "member", userId: raw.slice(2) });
    else if (raw.startsWith("e:")) onChange({ kind: "external", recommenderId: raw.slice(2) });
    else onChange(NO_RECOMMENDER);
  }

  async function saveName() {
    const displayName = name.trim();
    if (!displayName) { setError(t("nameRequired")); return; }
    setBusy(true);
    setError(null);
    try {
      const made = await source.create(displayName);
      onChange({ kind: "external", recommenderId: made.id });
      setAdding(false);
      setName("");
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {compact ? null : <span className="text-[13px] font-medium text-[var(--ink)]">{t("label")}</span>}
      <select
        className={inputClass}
        aria-label={t("label")}
        value={selectValue}
        disabled={disabled}
        onChange={(event) => pick(event.target.value)}
      >
        <option value="">{t("none")}</option>
        {members.length ? (
          <optgroup label={t("members")}>
            {members.map((member) => <option key={member.id} value={`m:${member.id}`}>{member.name}</option>)}
          </optgroup>
        ) : null}
        {source.recommenders.length ? (
          <optgroup label={t("saved")}>
            {source.recommenders.map((person) => <option key={person.id} value={`e:${person.id}`}>{person.displayName}</option>)}
          </optgroup>
        ) : null}
        <option value={NEW}>{t("addOutside")}</option>
        <option value={NOTE}>{t("writeNote")}</option>
      </select>

      {adding ? (
        <div className="rounded-xl border border-[var(--main-line)] bg-[var(--main-soft)]/40 p-3">
          <p className="mb-2 text-xs leading-5 text-[var(--muted)]">{t("outsideHint")}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className={inputClass}
              value={name}
              maxLength={80}
              placeholder={t("namePlaceholder")}
              aria-label={t("nameLabel")}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveName(); } }}
            />
            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => void saveName()}>{busy ? t("saving") : t("saveName")}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => { setAdding(false); setError(null); }}>{t("cancel")}</Button>
            </div>
          </div>
        </div>
      ) : null}
      {value.kind === "note" && !adding ? (
        <input
          className={inputClass}
          value={value.text}
          maxLength={200}
          placeholder={t("notePlaceholder")}
          aria-label={t("writeNote")}
          onChange={(event) => onChange({ kind: "note", text: event.target.value })}
        />
      ) : null}
      {error ? <p className="text-xs text-[var(--danger-strong)]">{error}</p> : null}
    </div>
  );
}

/** The byline under an item: "recommended by Ana", for whichever way it was recorded. */
export function recommenderLine(
  ref: RecommenderRef | null | undefined,
  originNote: string | null | undefined,
  line: (name: string) => string,
  note: (text: string) => string,
): string | null {
  if (ref) return line(ref.name);
  if (originNote?.trim()) return note(originNote.trim());
  return null;
}
