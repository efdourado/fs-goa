import type { SeedContext } from "../runtime";
import { fail } from "../runtime";
import { cinema } from "./cinema";
import type { Scenario, ScenarioResult } from "./types";

export type { Scenario, ScenarioResult } from "./types";

/**
 * Cinema is the vertical slice. Library / Bookshelf / Habit land here once the
 * Wrapped format has been reviewed against the first full result.
 */
const NOT_YET = (key: string): Scenario => ({
  key,
  title: `${key} — ainda não implementado`,
  plan: () => `(${key}: cenário ainda não escrito — só cinema por enquanto)`,
  run: () => fail(`O cenário "${key}" ainda não foi escrito. Rode --scenario=cinema.`),
});

export const SCENARIOS: Record<string, Scenario> = {
  cinema,
  library: NOT_YET("library"),
  bookshelf: NOT_YET("bookshelf"),
  habit: NOT_YET("habit"),
};

export const SCENARIO_ORDER = ["cinema", "library", "bookshelf", "habit"] as const;

export function selectScenarios(name: string): Scenario[] {
  if (name === "all") return SCENARIO_ORDER.map((key) => SCENARIOS[key]);
  const scenario = SCENARIOS[name];
  if (!scenario) fail(`Cenário desconhecido: "${name}". Use cinema, library, bookshelf, habit ou all.`);
  return [scenario];
}

export type { SeedContext, ScenarioResult as Result };
