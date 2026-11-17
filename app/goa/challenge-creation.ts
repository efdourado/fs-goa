import type { ChallengeCreationInput, ChallengeField } from "./types";

export interface ChallengeLibrary {
  id: string | null;
  kind: string;
  source: "screens" | "pages" | "tables" | "custom";
  label: string | null;
}

/** Translate list/check-in choices to the existing storage/logging modes. */
export function challengeRecording(library: ChallengeLibrary | null, dated: boolean, responseName: string, entryName: string): Pick<ChallengeCreationInput, "recipe" | "libraries" | "recordingMode" | "sessionName" | "includeSessionNote" | "responseName"> {
  if (!library) return { recipe: "habit", responseName };
  return {
    recipe: "custom", libraries: [library.id ? { libraryId: library.id } : { libraryKind: library.kind }], responseName,
    ...(dated ? { recordingMode: "session", sessionName: entryName, includeSessionNote: false } : { recordingMode: "single" }),
  };
}

export function initialResponseFields(label: string): ChallengeField[] {
  return [{ key: "value", label, type: "text", required: false, config: { maxLength: 280 } }];
}
