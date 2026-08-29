export const DEFAULT_TEXT_MAX_LENGTH = 5_000;
export const NUMBER_ABSOLUTE_LIMIT = Number.MAX_SAFE_INTEGER;

export type FieldType = "text" | "number" | "rating" | "choice" | "boolean" | "date";

export type ValidationCode =
  | "required"
  | "invalid_type"
  | "invalid_text"
  | "too_short"
  | "too_long"
  | "out_of_range"
  | "invalid_step"
  | "invalid_choice"
  | "invalid_date"
  | "invalid_configuration";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ValidationCode; message: string };

export interface TextConstraints {
  minLength?: number;
  maxLength?: number;
}

export interface NumberConstraints {
  min?: number;
  max?: number;
  step?: number;
}

interface BaseFieldDefinition {
  required?: boolean;
}

export interface TextFieldDefinition extends BaseFieldDefinition, TextConstraints {
  type: "text";
}

export interface NumberFieldDefinition extends BaseFieldDefinition, NumberConstraints {
  type: "number";
}

export interface RatingFieldDefinition extends BaseFieldDefinition {
  type: "rating";
}

export interface ChoiceFieldDefinition extends BaseFieldDefinition {
  type: "choice";
  optionIds: readonly string[];
}

export interface BooleanFieldDefinition extends BaseFieldDefinition {
  type: "boolean";
}

export interface DateFieldDefinition extends BaseFieldDefinition {
  type: "date";
}

export type FieldDefinition =
  | TextFieldDefinition
  | NumberFieldDefinition
  | RatingFieldDefinition
  | ChoiceFieldDefinition
  | BooleanFieldDefinition
  | DateFieldDefinition;

export type FieldValue = string | number | boolean | null;

function valid<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function invalid<T>(code: ValidationCode, message: string): ValidationResult<T> {
  return { ok: false, code, message };
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function numberConfigurationIsValid({ min, max, step }: NumberConstraints): boolean {
  if (min !== undefined && (!Number.isFinite(min) || Math.abs(min) > NUMBER_ABSOLUTE_LIMIT)) {
    return false;
  }

  if (max !== undefined && (!Number.isFinite(max) || Math.abs(max) > NUMBER_ABSOLUTE_LIMIT)) {
    return false;
  }

  if (min !== undefined && max !== undefined && min > max) {
    return false;
  }

  return step === undefined || (Number.isFinite(step) && step > 0 && step <= NUMBER_ABSOLUTE_LIMIT);
}

function followsStep(value: number, step: number, base: number): boolean {
  const quotient = (value - base) / step;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(quotient)) * 8;
  return Math.abs(quotient - Math.round(quotient)) <= tolerance;
}

/** Validates text without trimming, normalizing, or otherwise changing it. */
export function validateTextValue(
  value: unknown,
  constraints: TextConstraints = {},
): ValidationResult<string> {
  if (typeof value !== "string") {
    return invalid("invalid_type", "Expected a text value.");
  }

  const minLength = constraints.minLength ?? 0;
  const maxLength = constraints.maxLength ?? DEFAULT_TEXT_MAX_LENGTH;

  if (
    !isNonNegativeInteger(minLength) ||
    !isNonNegativeInteger(maxLength) ||
    minLength > maxLength
  ) {
    return invalid("invalid_configuration", "Text length constraints are invalid.");
  }

  if (value.includes("\0")) {
    return invalid("invalid_text", "Text cannot contain a null character.");
  }

  const length = unicodeLength(value);
  if (length < minLength) {
    return invalid("too_short", `Text must have at least ${minLength} characters.`);
  }

  if (length > maxLength) {
    return invalid("too_long", `Text must have at most ${maxLength} characters.`);
  }

  return valid(value);
}

/** Accepts JSON numbers only; numeric strings, NaN, and infinities are rejected. */
export function validateNumberValue(
  value: unknown,
  constraints: NumberConstraints = {},
): ValidationResult<number> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return invalid("invalid_type", "Expected a finite number.");
  }

  if (!numberConfigurationIsValid(constraints)) {
    return invalid("invalid_configuration", "Number constraints are invalid.");
  }

  if (Math.abs(value) > NUMBER_ABSOLUTE_LIMIT) {
    return invalid("out_of_range", "Number is outside the supported range.");
  }

  if (constraints.min !== undefined && value < constraints.min) {
    return invalid("out_of_range", `Number must be at least ${constraints.min}.`);
  }

  if (constraints.max !== undefined && value > constraints.max) {
    return invalid("out_of_range", `Number must be at most ${constraints.max}.`);
  }

  if (
    constraints.step !== undefined &&
    !followsStep(value, constraints.step, constraints.min ?? 0)
  ) {
    return invalid("invalid_step", `Number must follow increments of ${constraints.step}.`);
  }

  return valid(Object.is(value, -0) ? 0 : value);
}

/** MVP rating: zero to five inclusive, in half-point increments. */
export function validateRatingValue(value: unknown): ValidationResult<number> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return invalid("invalid_type", "Expected a numeric rating.");
  }

  if (value < 0 || value > 5) {
    return invalid("out_of_range", "Rating must be between 0 and 5.");
  }

  if (!Number.isInteger(value * 2)) {
    return invalid("invalid_step", "Rating must use half-point increments.");
  }

  return valid(Object.is(value, -0) ? 0 : value);
}

/** Choice values are stable option IDs, never mutable labels. */
export function validateChoiceValue(
  value: unknown,
  optionIds: readonly string[],
): ValidationResult<string> {
  if (
    !Array.isArray(optionIds) ||
    optionIds.length === 0 ||
    optionIds.some((optionId) => typeof optionId !== "string" || optionId.length === 0) ||
    new Set(optionIds).size !== optionIds.length
  ) {
    return invalid("invalid_configuration", "Choice options must contain unique, non-empty IDs.");
  }

  if (typeof value !== "string") {
    return invalid("invalid_type", "Expected a choice option ID.");
  }

  if (!optionIds.includes(value)) {
    return invalid("invalid_choice", "Choice does not belong to this field.");
  }

  return valid(value);
}

export function validateBooleanValue(value: unknown): ValidationResult<boolean> {
  return typeof value === "boolean"
    ? valid(value)
    : invalid("invalid_type", "Expected a boolean value.");
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** Accepts only a real calendar date in canonical YYYY-MM-DD form. */
export function validateDateValue(value: unknown): ValidationResult<string> {
  if (typeof value !== "string") {
    return invalid("invalid_type", "Expected an ISO date string.");
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) {
    return invalid("invalid_date", "Date must use YYYY-MM-DD.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysPerMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  if (year === 0 || month < 1 || month > 12 || day < 1 || day > daysPerMonth[month - 1]) {
    return invalid("invalid_date", "Date is not a real calendar date.");
  }

  return valid(value);
}

/** Validates nullable/required behavior before dispatching by field type. */
export function validateFieldValue(
  definition: FieldDefinition,
  value: unknown,
): ValidationResult<FieldValue> {
  if (value === null || value === undefined) {
    return definition.required
      ? invalid("required", "This field is required.")
      : valid(null);
  }

  if (definition.required && definition.type === "text" && typeof value === "string" && value.trim() === "") {
    return invalid("required", "This field is required.");
  }

  switch (definition.type) {
    case "text":
      return validateTextValue(value, definition);
    case "number":
      return validateNumberValue(value, definition);
    case "rating":
      return validateRatingValue(value);
    case "choice":
      return validateChoiceValue(value, definition.optionIds);
    case "boolean":
      return validateBooleanValue(value);
    case "date":
      return validateDateValue(value);
    default:
      return invalid("invalid_configuration", "Unsupported field type.");
  }
}

/**
 * Prevents spreadsheet applications from interpreting untrusted CSV text as
 * a formula. CSV quoting/escaping should be applied after this guard.
 */
export function guardCsvFormula(value: string): string {
  if (typeof value !== "string") {
    throw new TypeError("CSV formula guard expects a string.");
  }

  const startsWithControl = /^[\t\r\n]/u.test(value);
  const startsWithFormula = /^[ \t\r\n]*[=+@-]/u.test(value);

  return startsWithControl || startsWithFormula ? `'${value}` : value;
}

/** Produces a quoted CSV cell after applying the formula-injection guard. */
export function escapeCsvCell(value: string): string {
  const guarded = guardCsvFormula(value);
  return `"${guarded.replaceAll('"', '""')}"`;
}
