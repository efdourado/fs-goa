/**
 * Builds the label bags the pure `rankings-view` components need, from any
 * next-intl translator (`useTranslations` on the client, `getTranslations` on
 * the server-rendered public page). Keeps i18n keys in one place.
 */

type Translator = (key: string, values?: Record<string, string | number>) => string;

const DIMENSION_KEYS: Record<string, string> = {
  items: "dimItems",
  genre: "dimGenre",
  year_band: "dimYearBand",
  duration: "dimDuration",
};

export function rankingLabels(t: Translator) {
  return {
    title: t("rankings.title"),
    entryCount: t("rankings.entryCount"),
    completion: t("rankings.completion"),
    average: t("rankings.average"),
    median: t("rankings.median"),
    range: t("rankings.range"),
    consistency: t("rankings.consistency"),
    topItems: t("rankings.topItems"),
    bottomItems: t("rankings.bottomItems"),
    surprise: t("rankings.surprise"),
    disappointment: t("rankings.disappointment"),
    indication: t("rankings.indication"),
    none: t("rankings.none"),
  };
}

export function affinityLabels(t: Translator) {
  return {
    title: t("affinity.title"),
    explanation: t("affinity.explanation"),
    sample: (n: number) => t("affinity.sample", { n }),
    composite: t("affinity.composite"),
    compositeNote: t("affinity.compositeNote"),
    dimension: (key: string) => t(`affinity.${DIMENSION_KEYS[key] ?? "dimItems"}`),
    none: t("affinity.none"),
  };
}
