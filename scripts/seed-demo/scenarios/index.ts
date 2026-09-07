import { fail } from "../runtime";
import { bookshelf } from "./bookshelf";
import { cinema } from "./cinema";
import { habit } from "./habit";
import { library } from "./library";
import type { Scenario } from "./types";

export type { Scenario, ScenarioResult } from "./types";

export const SCENARIOS: Record<string, Scenario> = { cinema, library, bookshelf, habit };

export const SCENARIO_ORDER = ["cinema", "library", "bookshelf", "habit"] as const;

export function selectScenarios(name: string): Scenario[] {
  if (name === "all") return SCENARIO_ORDER.map((key) => SCENARIOS[key]);
  const scenario = SCENARIOS[name];
  if (!scenario) fail(`Cenário desconhecido: "${name}". Use cinema, library, bookshelf, habit ou all.`);
  return [scenario];
}

export type { ScenarioResult as Result } from "./types";
