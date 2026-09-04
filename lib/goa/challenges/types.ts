export type MetricOperation =
  | "sum"
  | "average"
  | "count"
  | "min"
  | "max"
  | "completion_rate"
  | "bayesian_average"
  | "spread"
  | "surprise"
  | "indicator_bias";

export interface MetricRow {
  id: string;
  challenge_id: string;
  entry_type_id: string;
  field_id: string | null;
  semantic_key: string;
  label: string;
  operation: MetricOperation;
  group_by: "none" | "participant" | "item" | "day" | "week" | "catalog_year" | "catalog_author" | "catalog_genre";
  decimal_places: number;
  visible_during_challenge: boolean;
  position: number;
  settings?: Record<string, unknown>;
}

export interface FieldRow {
  id: string;
  challenge_id: string;
  entry_type_id: string;
  semantic_key: string;
  label: string;
  help_text: string | null;
  kind: "text" | "number" | "rating" | "choice" | "boolean" | "date";
  required: boolean;
  position: number;
  number_scale: number | null;
  min_scaled: number | null;
  max_scaled: number | null;
  step_scaled: number | null;
  max_length: number | null;
  settings: Record<string, unknown>;
}
