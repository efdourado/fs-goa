import { PERSON_TONES } from "../rating-scale";
import type { Id } from "../types";
import type { DatedStory, RatedStory } from "./model";

const INITIAL_VISIBLE_PEOPLE = 6;

/** A person's line keeps its shade and pattern when the participant filter changes. */
export function threadPersonStyle(people: readonly Id[], id: Id) {
  const index = Math.max(0, people.indexOf(id));
  const base = PERSON_TONES[index % PERSON_TONES.length];
  const repeat = Math.floor(index / PERSON_TONES.length);
  if (!repeat) return { tone: base, dash: undefined };

  const tint = (60 * repeat / (repeat + 3)).toFixed(2);
  return {
    tone: `color-mix(in oklab, ${base}, white ${tint}%)`,
    dash: `${4 + ((repeat - 1) % 4) * 3} ${4 + Math.floor((repeat - 1) / 4) * 2}`,
  };
}

/** Start with contrasting rating patterns, or a spread of check-in frequencies. */
export function initialThreadSelection(story: RatedStory | DatedStory, people: readonly Id[]): Id[] {
  if (people.length <= INITIAL_VISIBLE_PEOPLE) return [];

  const disagreement = new Map<Id, Map<Id, number>>(people.map((id) => [id, new Map()]));
  if (story.kind === "rated") {
    for (const { a, b, agreement } of story.pairs) {
      disagreement.get(a.id)?.set(b.id, 100 - agreement);
      disagreement.get(b.id)?.set(a.id, 100 - agreement);
    }
  }
  const checkins = story.kind === "dated" ? new Map(story.lanes.map((lane) => [lane.person.id, lane.days.length])) : null;
  const distance = (a: Id, b: Id) => checkins
    ? Math.abs((checkins.get(a) ?? 0) - (checkins.get(b) ?? 0))
    : disagreement.get(a)?.get(b) ?? 0;

  const remaining = [...people];
  const selected: Id[] = [];
  while (selected.length < INITIAL_VISIBLE_PEOPLE) {
    let best = 0;
    let bestDistance = -1;
    for (const [index, candidate] of remaining.entries()) {
      const score = selected.length
        ? Math.min(...selected.map((id) => distance(candidate, id)))
        : Math.max(...remaining.map((id) => distance(candidate, id)));
      if (score > bestDistance) {
        best = index;
        bestDistance = score;
      }
    }
    selected.push(...remaining.splice(best, 1));
  }
  return selected;
}
