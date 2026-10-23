"use client";

import { useSyncExternalStore } from "react";

import type { CineRow } from "./cine-items";
import type { ChallengeField, ChallengeResponseInput, ChallengeRule, Id, SharedEditPolicy } from "./types";

/**
 * The challenge form as it was left: everything typed so far and the step it was on. Nothing exists on the server
 * until the form is finished.
 */
export interface ChallengeDraftForm {
  step: number;
  /** The persisted behaviour behind the creator's "with items" or "without items" choice. */
  structure: "list" | "progress" | "daily";
  title: string;
  description: string;
  ruleSections: ChallengeRule[];
  showOptional: boolean;
  scheduleMode: "period" | "none";
  startsOn: string;
  endsOn: string;
  fields: ChallengeField[];
  additionalResponses?: ChallengeResponseInput[];
  answerScope: "individual" | "shared";
  recordingMode: "single" | "session";
  sessionName: string;
  sharedEditPolicy: SharedEditPolicy;
  fieldsTouched: boolean;
  itemDates: boolean;
  expectation: boolean;
  cineItems: CineRow[];
  participantIds: Id[];
  pickedKind: string | null;
}

export interface ChallengeDraft {
  /** Where it was being made: the person's own space or one of their groups. */
  target: { personal: true } | { groupId: Id };
  savedAt: string;
  form: ChallengeDraftForm;
}

// One draft per person, kept in this browser (like the remembered sidebar), so it never reaches other devices.
// Read through an external store so the server render and the first client render agree.
const keyFor = (userId: Id) => `goa.challengeDraft.${userId}`;
const listeners = new Set<() => void>();
// The parsed draft for the last raw value read, so the store hands React the same object until it changes.
let cache: { raw: string | null; draft: ChallengeDraft | null } = { raw: null, draft: null };

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function readChallengeDraft(userId: Id): ChallengeDraft | null {
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(keyFor(userId)); } catch { return null; }
  if (raw === cache.raw) return cache.draft;
  let draft: ChallengeDraft | null = null;
  try {
    const parsed = raw ? (JSON.parse(raw) as ChallengeDraft) : null;
    // A draft from before the structures (it named a template instead) isn't picked back up.
    draft = parsed && parsed.form && parsed.target && parsed.form.structure ? parsed : null;
  } catch { draft = null; }
  cache = { raw, draft };
  return draft;
}

/** Keeps `draft` as the person's one draft, replacing whatever was there. */
export function saveChallengeDraft(userId: Id, draft: ChallengeDraft) {
  try { window.localStorage.setItem(keyFor(userId), JSON.stringify(draft)); } catch { /* storage blocked: the draft just isn't kept */ }
  listeners.forEach((listener) => listener());
}

export function clearChallengeDraft(userId: Id) {
  try { window.localStorage.removeItem(keyFor(userId)); } catch { /* storage blocked: nothing was kept */ }
  listeners.forEach((listener) => listener());
}

export function useChallengeDraft(userId: Id | null): ChallengeDraft | null {
  return useSyncExternalStore(subscribe, () => (userId ? readChallengeDraft(userId) : null), () => null);
}
