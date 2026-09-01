import type { ClientField } from "../domain/fields";
import { defaultFields } from "../domain/fields";
import type {
  Cardinality,
  Purpose,
  SchedulePolicy,
  SubmissionMode,
  TargetPolicy,
} from "./entry-types";
import type { MetricOperation } from "./types";

/**
 * A recipe is the versioned blueprint of a challenge: which entry types it opens
 * with (each carrying the four orthogonal axes and its own default fields), what
 * kind of catalog item it tracks, and whether it starts with a fixed period.
 *
 * `createChallenge` is the only writer; the wizard reads `SCHEDULE_MODE`/
 * `CATALOG_KIND` to pre-fill step 1. Bump `version` when an existing key's shape
 * changes so old rounds stay pinned to what they were built with.
 */
export interface RecipeEntryType {
  semanticKey: string;
  name: string;
  purpose: Purpose;
  submissionMode: SubmissionMode;
  targetPolicy: TargetPolicy;
  cardinality: Cardinality;
  schedulePolicy: SchedulePolicy;
  fields: ClientField[];
  /** The type the wizard's field step and the challenge detail's flat view use. */
  primary?: boolean;
}

/**
 * A default metric the recipe seeds so a fresh round produces a full showcase
 * with zero config. `fieldKey` is a field's semantic key on any of the recipe's
 * entry types (undefined for `count`/`completion_rate`).
 */
export interface RecipeMetric {
  key: string;
  label: string;
  operation: MetricOperation;
  fieldKey?: string;
  groupBy?: "none" | "participant" | "item";
  visibleDuring?: boolean;
  visibleInResults?: boolean;
  settings?: { minSample?: number; bayesPriorWeight?: number };
}

export interface Recipe {
  key: RecipeKey;
  version: number;
  catalogKind: "film" | "book" | null;
  scheduleMode: "none" | "period";
  entryTypes: RecipeEntryType[];
  metrics: RecipeMetric[];
}

export type RecipeKey = "cine_free" | "cine_curated" | "reading_club" | "reading_daily";

const ratingFields = (commentMax: number): ClientField[] => [
  { key: "nota", label: "Nota", type: "rating", required: true },
  {
    key: "comentario",
    label: "Comentário",
    type: "text",
    required: false,
    config: { multiline: true, maxLength: commentMax },
  },
];

const avaliacao = (primary: boolean): RecipeEntryType => ({
  semanticKey: "avaliacao",
  name: "Avaliação",
  purpose: "rating",
  submissionMode: "item",
  targetPolicy: "required",
  cardinality: "once_per_item",
  schedulePolicy: "while_active",
  fields: ratingFields(280),
  primary,
});

const expectativa: RecipeEntryType = {
  semanticKey: "expectativa",
  name: "Expectativa",
  purpose: "expectation",
  submissionMode: "item",
  targetPolicy: "required",
  cardinality: "once_per_item",
  schedulePolicy: "while_active",
  fields: [
    { key: "expectativa", label: "Expectativa", type: "rating", required: true },
    {
      key: "por_que",
      label: "Por quê?",
      type: "text",
      required: false,
      config: { multiline: true, maxLength: 200 },
    },
  ],
};

const progressoDia: RecipeEntryType = {
  semanticKey: "progresso",
  name: "Progresso do dia",
  purpose: "progress",
  // `daily` (not `item`) keeps the entry-shape CHECK from forcing an item, but a
  // reading-club round always targets a specific book, so the policy is required.
  submissionMode: "daily",
  targetPolicy: "required",
  cardinality: "once_per_item_day",
  schedulePolicy: "while_active",
  fields: [
    { key: "paginas", label: "Páginas lidas", type: "number", required: true, config: { min: 0, step: 1 } },
  ],
  primary: true,
};

const conclusao: RecipeEntryType = {
  semanticKey: "conclusao",
  name: "Conclusão",
  purpose: "completion",
  submissionMode: "item",
  targetPolicy: "required",
  cardinality: "once_per_item",
  schedulePolicy: "while_active",
  fields: [{ key: "concluido", label: "Livro concluído?", type: "boolean", required: true }],
};

const notaLivro: RecipeEntryType = {
  semanticKey: "avaliacao",
  name: "Avaliação",
  purpose: "rating",
  submissionMode: "item",
  targetPolicy: "required",
  cardinality: "once_per_item",
  schedulePolicy: "while_active",
  fields: ratingFields(500),
};

const registroDiario: RecipeEntryType = {
  semanticKey: "registro",
  name: "Registro",
  purpose: "checkin",
  submissionMode: "daily",
  targetPolicy: "none",
  cardinality: "once_per_day",
  schedulePolicy: "checkpoint",
  fields: defaultFields("reading"),
  primary: true,
};

const completionMetric: RecipeMetric = {
  key: "taxa_conclusao",
  label: "Taxa de conclusão",
  operation: "completion_rate",
  visibleDuring: true,
  visibleInResults: true,
};

const cineMetrics: RecipeMetric[] = [
  { key: "media_nota", label: "Nota média", operation: "average", fieldKey: "nota", groupBy: "none" },
  {
    key: "ranking",
    label: "Ranking dos filmes",
    operation: "bayesian_average",
    fieldKey: "nota",
    groupBy: "item",
    settings: { minSample: 3, bayesPriorWeight: 4 },
  },
  { key: "polarizacao", label: "Polarização por filme", operation: "spread", fieldKey: "nota", groupBy: "item", settings: { minSample: 2 } },
  {
    key: "vies_indicador",
    label: "Viés do indicador",
    operation: "indicator_bias",
    fieldKey: "nota",
    groupBy: "participant",
    settings: { minSample: 1 },
  },
  completionMetric,
];

export const RECIPES: Record<RecipeKey, Recipe> = {
  cine_free: {
    key: "cine_free",
    version: 1,
    catalogKind: "film",
    scheduleMode: "none",
    entryTypes: [avaliacao(true)],
    metrics: cineMetrics,
  },
  cine_curated: {
    key: "cine_curated",
    version: 1,
    catalogKind: "film",
    scheduleMode: "none",
    entryTypes: [expectativa, avaliacao(true)],
    metrics: [
      ...cineMetrics.slice(0, 4),
      {
        key: "surpresa",
        label: "Surpresa × decepção",
        operation: "surprise",
        fieldKey: "nota",
        groupBy: "item",
        settings: { minSample: 2 },
      },
      completionMetric,
    ],
  },
  reading_club: {
    key: "reading_club",
    version: 1,
    catalogKind: "book",
    scheduleMode: "period",
    entryTypes: [progressoDia, conclusao, notaLivro],
    metrics: [
      { key: "paginas_total", label: "Páginas lidas", operation: "sum", fieldKey: "paginas", groupBy: "none" },
      { key: "paginas_por_pessoa", label: "Páginas por pessoa", operation: "sum", fieldKey: "paginas", groupBy: "participant" },
      {
        key: "ranking",
        label: "Ranking dos livros",
        operation: "bayesian_average",
        fieldKey: "nota",
        groupBy: "item",
        settings: { minSample: 3, bayesPriorWeight: 4 },
      },
      completionMetric,
    ],
  },
  reading_daily: {
    key: "reading_daily",
    version: 1,
    catalogKind: null,
    scheduleMode: "period",
    entryTypes: [registroDiario],
    metrics: [
      { key: "media_paginas", label: "Média de páginas", operation: "average", fieldKey: "paginas_lidas", groupBy: "none" },
      completionMetric,
    ],
  },
};

const TEMPLATE_ALIAS: Record<string, RecipeKey> = {
  cine: "cine_free",
  reading: "reading_daily",
};

const AXES_BY_MODE: Record<SubmissionMode, Omit<RecipeEntryType, "semanticKey" | "name" | "fields" | "primary">> = {
  item: {
    purpose: "rating",
    submissionMode: "item",
    targetPolicy: "required",
    cardinality: "once_per_item",
    schedulePolicy: "while_active",
  },
  daily: {
    purpose: "checkin",
    submissionMode: "daily",
    targetPolicy: "none",
    cardinality: "once_per_day",
    schedulePolicy: "checkpoint",
  },
  free: {
    purpose: "checkin",
    submissionMode: "free",
    targetPolicy: "none",
    cardinality: "repeatable",
    schedulePolicy: "free",
  },
};

/**
 * Picks the recipe a create request wants. `recipe` is the modern field; a bare
 * `template` or `submissionMode` keeps older clients and the API test-suite
 * working — the latter builds a one-type recipe straight from the mode.
 */
export function resolveRecipe(body: Record<string, unknown>): Recipe {
  if (typeof body.recipe === "string" && body.recipe in RECIPES) {
    return RECIPES[body.recipe as RecipeKey];
  }
  if (typeof body.template === "string" && body.template in TEMPLATE_ALIAS) {
    return RECIPES[TEMPLATE_ALIAS[body.template]];
  }
  const mode: SubmissionMode =
    body.submissionMode === "daily" || body.submissionMode === "free" ? body.submissionMode : "item";
  const template = typeof body.template === "string" ? body.template : undefined;
  return {
    key: mode === "daily" ? "reading_daily" : "cine_free",
    version: 1,
    catalogKind: mode === "item" ? "film" : null,
    scheduleMode: mode === "item" ? "none" : "period",
    entryTypes: [
      {
        semanticKey: "registro",
        name: "Registro",
        ...AXES_BY_MODE[mode],
        fields: defaultFields(template),
        primary: true,
      },
    ],
    // Back-compat: the fixed pair the app seeded before recipes existed.
    metrics: [
      { key: "media", label: "Média", operation: "average", fieldKey: "nota", groupBy: "none" },
      completionMetric,
    ],
  };
}
