import type { SeedContext } from "../runtime";

export interface ScenarioResult {
  /** Human label for the summary table. */
  label: string;
  challengeId: string;
  /** Path under the app origin, e.g. `/challenges/<id>/manage`. */
  adminPath: string;
  participantPath: string;
  templatePath: string;
  /** Opaque public token for the anonymised Wrapped, if published. */
  publicResultToken: string | null;
  counts: Record<string, number>;
}

export interface Scenario {
  key: string;
  title: string;
  /** One-paragraph description of what a normal run would create (for `--dry-run`). */
  plan: (context: SeedContext) => string;
  /** Builds the scenario with the real domain services. Only called outside `--dry-run`. */
  run: (context: SeedContext) => Promise<ScenarioResult>;
}
