import type { ChallengeCreationInput } from "./types";

/**
 * The request body for creating a challenge, built from what the creation form collected. Every setting the
 * form can send has to be listed here — one left out is silently dropped and the server falls back to its
 * default (a workout-mode challenge coming back as one response per exercise).
 */
export function challengeRequestBody(input: ChallengeCreationInput) {
  return {
    recipe: input.recipe,
    ...(input.libraries?.length ? { libraries: input.libraries } : {}),
    title: input.title,
    description: input.description,
    ruleSections: input.ruleSections,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    fields: input.fields,
    items: input.items,
    generateDaily: input.generateDaily,
    expectation: input.expectation === true,
    ...(input.collectsEntryDate !== undefined ? { collectsEntryDate: input.collectsEntryDate } : {}),
    ...(input.answerScope ? { answerScope: input.answerScope } : {}),
    ...(input.recordingMode ? { recordingMode: input.recordingMode } : {}),
    ...(input.sessionName ? { sessionName: input.sessionName } : {}),
    ...(input.sessionNoteLabel ? { sessionNoteLabel: input.sessionNoteLabel } : {}),
    ...(input.sharedEditPolicy ? { sharedEditPolicy: input.sharedEditPolicy } : {}),
    ...(input.itemDates ? { itemDates: true } : {}),
    participantIds: input.participantIds,
  };
}
