import { ApiError, stringValue } from "../../http";

export interface ChallengeRuleSection {
  title: string;
  description: string;
}

const MAX_RULE_SECTIONS = 20;
const MAX_RULES_TOTAL_LENGTH = 10_000;

function legacyRuleSections(value: unknown): ChallengeRuleSection[] {
  if (value === undefined || value === null || value === "") return [];
  const description = stringValue(
    { description: value },
    "description",
    { max: MAX_RULES_TOTAL_LENGTH, optional: true },
  );
  return description ? [{ title: "Regras do desafio", description }] : [];
}

export function parseRuleSections(
  value: unknown,
  legacyRules?: unknown,
): ChallengeRuleSection[] {
  if (value === undefined || value === null) return legacyRuleSections(legacyRules);
  if (!Array.isArray(value)) {
    throw new ApiError(400, "invalid_rules", "As regras precisam ser uma lista de títulos e descrições.");
  }
  if (value.length > MAX_RULE_SECTIONS) {
    throw new ApiError(400, "rule_limit", `Use no máximo ${MAX_RULE_SECTIONS} regras.`);
  }

  const sections = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ApiError(400, "invalid_rules", "Cada regra precisa ter título e descrição.");
    }
    const record = item as Record<string, unknown>;
    return {
      title: stringValue(record, "title", { min: 1, max: 160 })!,
      description: stringValue(record, "description", { min: 1, max: MAX_RULES_TOTAL_LENGTH })!,
    };
  });
  const totalDescriptionLength = sections.reduce(
    (total, section) => total + section.description.length,
    0,
  );
  if (totalDescriptionLength > MAX_RULES_TOTAL_LENGTH) {
    throw new ApiError(400, "rules_too_long", "O conjunto de regras pode ter no máximo 10.000 caracteres.");
  }
  return sections;
}

export function rulesCompatibilityText(sections: ChallengeRuleSection[]): string | null {
  if (!sections.length) return null;
  return sections.map((section) => `${section.title}\n${section.description}`).join("\n\n");
}
