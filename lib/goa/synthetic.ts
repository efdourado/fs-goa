/**
 * `db:seed-demo` tags the description of the group it builds with this marker so
 * it can recognise its own group on the next run without matching on the name
 * (which the operator may rename). The marker is never shown as text: the group
 * screen renders it in a background-coloured span — invisible unless you select
 * the whole description — and it is stripped from anything a user edits, while
 * `updateGroup` re-appends it so an edit can't strand the seed script.
 */
export const SYNTHETIC_MARKER = "⟦seed-demo⟧";

export function hasSyntheticMarker(text: string | null | undefined): boolean {
  return (text ?? "").includes(SYNTHETIC_MARKER);
}

/** The description with the marker (and any trailing whitespace it left) removed. */
export function stripSyntheticMarker(text: string | null | undefined): string {
  return (text ?? "").replace(SYNTHETIC_MARKER, "").replace(/\s+$/, "");
}

/** Splits a description into the visible text and the marker, if present. */
export function splitSyntheticMarker(text: string | null | undefined): {
  visible: string;
  marker: string | null;
} {
  return hasSyntheticMarker(text)
    ? { visible: stripSyntheticMarker(text), marker: SYNTHETIC_MARKER }
    : { visible: text ?? "", marker: null };
}
