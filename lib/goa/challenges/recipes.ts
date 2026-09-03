import type { ClientField } from "../domain/fields";
import { ApiError } from "../../http";
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
  /**
   * Only meaningful with more than one participant (disagreement, curator bias…).
   * A solo/personal round skips seeding these entirely.
   */
  needsGroup?: boolean;
  settings?: { minSample?: number; bayesPriorWeight?: number };
}

export interface Recipe {
  key: RecipeKey;
  version: number;
  catalogKind: "film" | "book" | null;
  scheduleMode: "none" | "period";
  /**
   * Whether a participant's entry form offers the optional "when did it happen"
   * date. A retrospective list ("books I've already read") never needs it, so
   * `bookshelf` opts out; the others default to true.
   */
  collectsEntryDate?: boolean;
  entryTypes: RecipeEntryType[];
  metrics: RecipeMetric[];
}

/** Recipes offered for new challenges. Historical rows keep their frozen shape. */
export type RecipeKey = "cinema" | "library" | "bookshelf";

/**
 * Stored by challenges created before the two-template consolidation. These keys
 * remain valid in the database so their existing entry types and fields can be
 * read faithfully, but `resolveRecipe` never creates a new challenge from them.
 */
export type LegacyRecipeKey =
  | "cine_free"
  | "cine_curated"
  | "reading_club"
  | "reading_daily";

export type StoredRecipeKey = RecipeKey | LegacyRecipeKey;

const LEGACY_RECIPE_KEYS = new Set<string>([
  "cine_free",
  "cine_curated",
  "reading_club",
  "reading_daily",
]);

export function isLegacyRecipeKey(value: unknown): value is LegacyRecipeKey {
  return typeof value === "string" && LEGACY_RECIPE_KEYS.has(value);
}

export function isRecipeKey(value: unknown): value is RecipeKey {
  return value === "cinema" || value === "library" || value === "bookshelf";
}

/**
 * Whether a challenge on this recipe collects the optional per-entry date. Unknown
 * / legacy keys keep the historical default (true).
 */
export function recipeCollectsEntryDate(key: string | null | undefined): boolean {
  return isRecipeKey(key) ? RECIPES[key].collectsEntryDate !== false : true;
}

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

// "Terminei o livro" — the entry existing means done; nota and comentário are
// optional and can come later (fact first, opinion later).
const conclusao: RecipeEntryType = {
  semanticKey: "conclusao",
  name: "Terminei",
  purpose: "completion",
  submissionMode: "item",
  targetPolicy: "required",
  cardinality: "once_per_item",
  schedulePolicy: "while_active",
  fields: [
    { key: "nota", label: "Nota", type: "rating", required: false, config: { min: 0, max: 5, step: 0.5 } },
    { key: "comentario", label: "Comentário", type: "text", required: false, config: { multiline: true, maxLength: 500 } },
  ],
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
  { key: "polarizacao", label: "Polarização por filme", operation: "spread", fieldKey: "nota", groupBy: "item", needsGroup: true, settings: { minSample: 2 } },
  {
    key: "vies_indicador",
    label: "Viés do indicador",
    operation: "indicator_bias",
    fieldKey: "nota",
    groupBy: "participant",
    needsGroup: true,
    settings: { minSample: 1 },
  },
  completionMetric,
];

export const RECIPES: Record<RecipeKey, Recipe> = {
  cinema: {
    key: "cinema",
    version: 1,
    catalogKind: "film",
    // The period is always optional: an undated Cinema round is an open-ended
    // watchlist, an undated Library is a reading habit. The wizard only uses this
    // as the initial toggle position.
    scheduleMode: "none",
    entryTypes: [avaliacao(true)],
    metrics: cineMetrics,
  },
  library: {
    key: "library",
    version: 1,
    catalogKind: "book",
    scheduleMode: "period",
    entryTypes: [progressoDia, conclusao],
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
  // "Rate a list of books" — the Cinema shape for a bookshelf: each book gets a
  // rating and an optional comment, no period, no pages, no "when did it happen".
  bookshelf: {
    key: "bookshelf",
    version: 1,
    catalogKind: "book",
    scheduleMode: "none",
    collectsEntryDate: false,
    entryTypes: [avaliacao(true)],
    metrics: [
      { key: "media_nota", label: "Nota média", operation: "average", fieldKey: "nota", groupBy: "none" },
      {
        key: "ranking",
        label: "Ranking dos livros",
        operation: "bayesian_average",
        fieldKey: "nota",
        groupBy: "item",
        settings: { minSample: 3, bayesPriorWeight: 4 },
      },
      { key: "polarizacao", label: "Polarização por livro", operation: "spread", fieldKey: "nota", groupBy: "item", needsGroup: true, settings: { minSample: 2 } },
      {
        key: "vies_indicador",
        label: "Viés do indicador",
        operation: "indicator_bias",
        fieldKey: "nota",
        groupBy: "participant",
        needsGroup: true,
        settings: { minSample: 1 },
      },
      completionMetric,
    ],
  },
};

const TEMPLATE_ALIAS: Record<string, RecipeKey> = {
  cine: "cinema",
  reading: "library",
  estante: "bookshelf",
};

/**
 * Picks one of the only recipes that can create a challenge. The four former
 * recipe keys deliberately fail here: their rows remain readable because every
 * challenge stores its concrete entry types/fields, but they cannot seed new
 * structures. The old `cine`/`reading` template aliases lead to the current
 * Cinema/Library definitions while clients migrate to `recipe`.
 */
export function resolveRecipe(body: Record<string, unknown>): Recipe {
  if (Object.hasOwn(body, "recipe")) {
    if (!isRecipeKey(body.recipe)) {
      throw new ApiError(400, "invalid_recipe", "Escolha o modelo Cinema, Estante ou Clube de leitura.");
    }
    return RECIPES[body.recipe];
  }
  if (Object.hasOwn(body, "template")) {
    if (typeof body.template !== "string" || !Object.hasOwn(TEMPLATE_ALIAS, body.template)) {
      throw new ApiError(400, "invalid_recipe", "Escolha o modelo Cinema, Estante ou Clube de leitura.");
    }
    return RECIPES[TEMPLATE_ALIAS[body.template]];
  }

  // A pre-recipe item client maps naturally to Cinema. Daily/free no longer
  // describe a supported template and must not silently recreate Journal.
  if (body.submissionMode === undefined || body.submissionMode === "item") {
    return RECIPES.cinema;
  }
  throw new ApiError(400, "invalid_recipe", "Escolha o modelo Cinema, Estante ou Clube de leitura.");
}
