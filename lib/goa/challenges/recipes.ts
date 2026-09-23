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
interface RecipeEntryType {
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
  /** The `semanticKey` of the type whose entries hold this one's — a workout's exercise records. */
  parentKey?: string;
}

/**
 * A default metric the recipe seeds so a fresh round produces a full showcase
 * with zero config. `fieldKey` is a field's semantic key on any of the recipe's
 * entry types (undefined for `count`/`completion_rate`).
 */
interface RecipeMetric {
  key: string;
  label: string;
  operation: MetricOperation;
  fieldKey?: string;
  /**
   * Several field keys instead of one: the metric averages them together per entry (Tables' "Nota geral" —
   * the mean of its three ratings) rather than reading a single measure. Mutually exclusive with `fieldKey`;
   * skipped, like a single field that no longer resolves, if any key doesn't.
   */
  fieldKeys?: string[];
  /** Reads this entry type instead of the primary one — attendance counts the visits, not the records inside. */
  entryTypeKey?: string;
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

interface Recipe {
  key: RecipeKey;
  version: number;
  catalogKind: "film" | "book" | null;
  /**
   * When true, the actual catalog kind isn't fixed here — it comes from the
   * request's `libraryId` (any workspace library, built-in or user-created;
   * see `resolveItemKind` in `../catalog`). Only `custom` sets this; every
   * other recipe keeps drawing from its fixed `catalogKind` exactly as before.
   */
  catalogKindFromBody?: boolean;
  /**
   * With `catalogKindFromBody`, a request that names no `libraryId` gets the
   * workspace's library of this starting config instead — created on first use
   * — so a preset like Tables works from a blank workspace.
   */
  defaultLibrarySource?: "tables";
  /**
   * The creator decides what participants record, so the recipe's default
   * fields are only a starting point: preflight does not insist the primary
   * type keeps them (a rating, say). Only `custom` sets this.
   */
  userDefinedFields?: boolean;
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

/**
 * Recipes offered for new challenges. Historical rows keep their frozen shape, and may carry an older
 * key (`cine_free`, `cine_curated`, `reading_club`, `reading_daily`) that is still read faithfully but
 * that `resolveRecipe` never creates a challenge from.
 */
export type RecipeKey = "cinema" | "library" | "bookshelf" | "habit" | "custom" | "tables";

export function isRecipeKey(value: unknown): value is RecipeKey {
  return value === "cinema" || value === "library" || value === "bookshelf" || value === "habit" || value === "custom" || value === "tables";
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
  // Nota 0–5 passo 0,5; comentário opcional até 500 (V1 §3.1).
  fields: ratingFields(500),
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

// A blank check-in for anything that isn't a film/book list: no target item, no
// preset numeric field. The idea is for the wizard's Fields step and the
// admin's Metrics tab to carry the whole shape — this recipe just opens the
// door (a daily "registro", once per day) so a personalized habit tracker
// doesn't have to masquerade as Cinema or Library.
const habitCheckin: RecipeEntryType = {
  semanticKey: "registro",
  name: "Registro",
  purpose: "checkin",
  submissionMode: "daily",
  targetPolicy: "none",
  cardinality: "once_per_day",
  schedulePolicy: "while_active",
  fields: [
    { key: "nota_dia", label: "Como foi?", type: "text", required: false, config: { multiline: true, maxLength: 500 } },
  ],
  primary: true,
};

// A generic item-targeted response for a workspace's own library (Matches,
// Tables, anything user-defined) — same shape as `avaliacao`, just not tied
// to a fixed catalog kind. `wizardFields` fully replaces these defaults, same
// as every other recipe's primary type, so "what participants record" stays
// a real configuration step, not a hardcoded score+comment pair.
const customEntry: RecipeEntryType = {
  semanticKey: "registro",
  name: "Registro",
  purpose: "rating",
  submissionMode: "item",
  targetPolicy: "required",
  cardinality: "once_per_item",
  schedulePolicy: "while_active",
  fields: ratingFields(500),
  primary: true,
};

// Tables (restaurants, bars, cafés): three 0–5 ratings and an optional
// comment. Deliberately no address, visit date, price, overall rating or
// "would return" — the creator adds those as fields if they want them.
const tablesEntry: RecipeEntryType = {
  semanticKey: "avaliacao",
  name: "Avaliação",
  purpose: "rating",
  submissionMode: "item",
  targetPolicy: "required",
  cardinality: "once_per_item",
  schedulePolicy: "while_active",
  fields: [
    { key: "comida", label: "Comida e bebida", type: "rating", required: true },
    { key: "ambiente_atendimento", label: "Ambiente e atendimento", type: "rating", required: true },
    { key: "custo_beneficio", label: "Custo-benefício", type: "rating", required: true },
    { key: "comentario", label: "Comentário", type: "text", required: false, config: { multiline: true, maxLength: 500 } },
  ],
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
    // 2, not 3: a club of exactly two people (a common size) would never see a
    // single film ranked otherwise, since no film ever gets a third rating.
    settings: { minSample: 2, bayesPriorWeight: 4 },
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
  // A personalized daily check-in with no catalog at all — studying, a workout,
  // a mood log. The wizard's Fields step and the admin's Metrics tab (any
  // numeric field can already feed a Sum/Average/Min/Max metric) are the whole
  // template; only completion rate is seeded.
  habit: {
    key: "habit",
    version: 1,
    catalogKind: null,
    scheduleMode: "none",
    entryTypes: [habitCheckin],
    metrics: [completionMetric],
  },
  // A challenge built on one of the workspace's own libraries (Matches,
  // Tables, or any other) instead of the fixed film/book catalog. `catalogKind`
  // stays null here — `catalogKindFromBody` sends `createChallenge` to
  // `body.libraryId` instead, resolved against this group's own libraries.
  custom: {
    key: "custom",
    version: 1,
    catalogKind: null,
    catalogKindFromBody: true,
    userDefinedFields: true,
    scheduleMode: "none",
    // A response is about something else (a match, a place), so "when did it happen" is only asked
    // when the creator turns it on — every save is still timestamped internally.
    collectsEntryDate: false,
    entryTypes: [customEntry],
    metrics: [completionMetric],
  },
  // A ready-made challenge on a Tables library: rate each place on food,
  // atmosphere/service and value, plus one combined score averaging all three.
  tables: {
    key: "tables",
    version: 2,
    catalogKind: null,
    catalogKindFromBody: true,
    defaultLibrarySource: "tables",
    scheduleMode: "none",
    collectsEntryDate: false,
    entryTypes: [tablesEntry],
    metrics: [
      { key: "media_comida", label: "Comida e bebida (média por lugar)", operation: "average", fieldKey: "comida", groupBy: "item" },
      { key: "media_ambiente_atendimento", label: "Ambiente e atendimento (média por lugar)", operation: "average", fieldKey: "ambiente_atendimento", groupBy: "item" },
      { key: "media_custo_beneficio", label: "Custo-benefício (média por lugar)", operation: "average", fieldKey: "custo_beneficio", groupBy: "item" },
      {
        key: "nota_geral",
        label: "Nota geral (média por lugar)",
        operation: "average",
        fieldKeys: ["comida", "ambiente_atendimento", "custo_beneficio"],
        groupBy: "item",
      },
      completionMetric,
    ],
  },
};

// One check-in that holds several item records — a workout of exercises, a study session of subjects, a
// match night of games. The visit is the entry (a date, an optional note, attendance); each item in it
// gets its own record with the fields the creator defined. Only `custom` offers it: `wizardFields` are the
// fields of one *record*, so the primary type is the record type and the visit is its parent.
const SESSION_KEY = "sessao";
const sessionEntry = (name: string): RecipeEntryType => ({
  semanticKey: SESSION_KEY,
  name,
  purpose: "checkin",
  // `daily` (not `free`) so the dashboard's progress counter shows a plain count of visits, like a habit.
  submissionMode: "daily",
  targetPolicy: "none",
  cardinality: "repeatable",
  schedulePolicy: "while_active",
  fields: [
    { key: "nota_sessao", label: "Como foi?", type: "text", required: false, config: { multiline: true, maxLength: 500 } },
  ],
});
const recordEntry: RecipeEntryType = {
  semanticKey: "desempenho",
  name: "Desempenho",
  purpose: "progress",
  submissionMode: "item",
  targetPolicy: "required",
  cardinality: "repeatable",
  schedulePolicy: "while_active",
  fields: [
    { key: "carga", label: "Carga", type: "number", required: true, config: { min: 0, step: 0.5 } },
    { key: "repeticoes", label: "Repetições", type: "number", required: true, config: { min: 0, step: 1 } },
  ],
  primary: true,
  parentKey: SESSION_KEY,
};

export type RecordingMode = "single" | "session";

/**
 * A `custom` challenge can record one answer per item (the default) or one check-in holding a record for
 * each of several items. Any other recipe refuses `session`; the recipe it returns is what `createChallenge` builds from.
 */
export function withRecordingMode(recipe: Recipe, body: Record<string, unknown>): { recipe: Recipe; mode: RecordingMode } {
  const requested = body.recordingMode;
  if (requested !== undefined && requested !== "single" && requested !== "session") {
    throw new ApiError(400, "invalid_recording_mode", "Escolha se cada registro é uma resposta por item ou um check-in com vários itens.");
  }
  if (requested !== "session") return { recipe, mode: "single" };
  if (recipe.key !== "custom") {
    throw new ApiError(400, "session_custom_only", "Só um desafio personalizado pode registrar um check-in com vários itens.");
  }
  const rawName = typeof body.sessionName === "string" ? body.sessionName.trim() : "";
  const name = (rawName || "Sessão").slice(0, 60);
  return {
    mode: "session",
    recipe: {
      ...recipe,
      entryTypes: [sessionEntry(name), recordEntry],
      metrics: [
        { key: "frequencia", label: "Frequência", operation: "count", entryTypeKey: SESSION_KEY, groupBy: "none" },
        { key: "frequencia_por_pessoa", label: "Frequência por pessoa", operation: "count", entryTypeKey: SESSION_KEY, groupBy: "participant", needsGroup: true },
        { key: "registros_por_item", label: "Registros por item", operation: "count", groupBy: "item" },
      ],
    },
  };
}

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
      throw new ApiError(400, "invalid_recipe", "Escolha o modelo Screens, Pages, Clube de leitura, Hábito, Tables ou Personalizado.");
    }
    return RECIPES[body.recipe];
  }
  if (Object.hasOwn(body, "template")) {
    if (typeof body.template !== "string" || !Object.hasOwn(TEMPLATE_ALIAS, body.template)) {
      throw new ApiError(400, "invalid_recipe", "Escolha o modelo Screens, Pages, Clube de leitura, Hábito, Tables ou Personalizado.");
    }
    return RECIPES[TEMPLATE_ALIAS[body.template]];
  }

  // A pre-recipe item client maps naturally to Cinema. Daily/free no longer
  // describe a supported template and must not silently recreate Journal.
  if (body.submissionMode === undefined || body.submissionMode === "item") {
    return RECIPES.cinema;
  }
  throw new ApiError(400, "invalid_recipe", "Escolha o modelo Screens, Pages ou Clube de leitura.");
}
