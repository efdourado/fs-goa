"use client";

import { useMemo } from "react";

import type { ChallengeDetail, Entry, Id } from "./types";
import { isItemDone } from "./utils";

/**
 * Which items each person has *done*, under the shared-aware rule in
 * `isItemDone`. Only worked out when the challenge has shared answers — without
 * any, "done" is simply "you recorded the completion answer" and the caller's
 * older, cheaper path covers it. Kept out of the screen component so the screen
 * never hands its entries to a function it can't see into.
 */
export function useDoneItems(
  challenge: ChallengeDetail,
  entries: Entry[],
  viewerId: Id | undefined,
): { forViewer: Set<Id>; isDone: (userId: Id | undefined, itemId: Id) => boolean } {
  return useMemo(() => {
    const byPerson = new Map<Id, Set<Id>>();
    if (challenge.entryTypes.some((type) => type.answerScope === "shared")) {
      const people = new Set<Id>(challenge.participants.map((participant) => participant.userId ?? participant.id));
      if (viewerId) people.add(viewerId);
      for (const person of people) {
        byPerson.set(person, new Set(challenge.items.filter((item) => isItemDone(challenge, entries, person, item.id)).map((item) => item.id)));
      }
    }
    return {
      forViewer: (viewerId ? byPerson.get(viewerId) : undefined) ?? new Set<Id>(),
      isDone: (userId: Id | undefined, itemId: Id) => (userId ? byPerson.get(userId)?.has(itemId) ?? false : false),
    };
  }, [challenge, entries, viewerId]);
}
