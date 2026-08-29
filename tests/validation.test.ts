import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  escapeCsvCell,
  guardCsvFormula,
  validateBooleanValue,
  validateChoiceValue,
  validateDateValue,
  validateFieldValue,
  validateNumberValue,
  validateRatingValue,
  validateTextValue,
} from "../lib/validation";

function assertInvalid(result: { ok: boolean; code?: string }, code: string): void {
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, code);
  }
}

describe("text validation", () => {
  test("preserves valid text and counts Unicode code points", () => {
    assert.deepEqual(validateTextValue("  texto  ", { minLength: 1, maxLength: 10 }), {
      ok: true,
      value: "  texto  ",
    });
    assert.deepEqual(validateTextValue("🎬", { minLength: 1, maxLength: 1 }), {
      ok: true,
      value: "🎬",
    });
  });

  test("rejects wrong types, null bytes, invalid bounds, and length violations", () => {
    assertInvalid(validateTextValue(12), "invalid_type");
    assertInvalid(validateTextValue("a\0b"), "invalid_text");
    assertInvalid(validateTextValue("a", { minLength: 2 }), "too_short");
    assertInvalid(validateTextValue("abc", { maxLength: 2 }), "too_long");
    assertInvalid(validateTextValue("abc", { minLength: 4, maxLength: 2 }), "invalid_configuration");
  });
});

describe("number and rating validation", () => {
  test("accepts finite numbers that satisfy range and decimal step", () => {
    assert.deepEqual(validateNumberValue(0.3, { min: 0, max: 1, step: 0.1 }), {
      ok: true,
      value: 0.3,
    });
    assert.deepEqual(validateNumberValue(-0), { ok: true, value: 0 });
  });

  test("rejects numeric strings, non-finite values, range errors, and invalid steps", () => {
    for (const value of ["2", Number.NaN, Number.POSITIVE_INFINITY] as const) {
      assertInvalid(validateNumberValue(value), "invalid_type");
    }

    assertInvalid(validateNumberValue(11, { max: 10 }), "out_of_range");
    assertInvalid(validateNumberValue(-1, { min: 0 }), "out_of_range");
    assertInvalid(validateNumberValue(0.25, { step: 0.5 }), "invalid_step");
    assertInvalid(validateNumberValue(1, { min: 5, max: 2 }), "invalid_configuration");
    assertInvalid(validateNumberValue(1, { step: 0 }), "invalid_configuration");
  });

  test("ratings are numbers from zero to five in half-point increments", () => {
    for (const value of [0, 0.5, 2.5, 5] as const) {
      assert.deepEqual(validateRatingValue(value), { ok: true, value });
    }

    assertInvalid(validateRatingValue("5"), "invalid_type");
    assertInvalid(validateRatingValue(-0.5), "out_of_range");
    assertInvalid(validateRatingValue(5.5), "out_of_range");
    assertInvalid(validateRatingValue(2.25), "invalid_step");
  });
});

describe("choice, boolean, and date validation", () => {
  test("choice uses stable option IDs and rejects labels or foreign IDs", () => {
    const optionIds = ["option-a", "option-b"] as const;

    assert.deepEqual(validateChoiceValue("option-b", optionIds), { ok: true, value: "option-b" });
    assertInvalid(validateChoiceValue("Option B", optionIds), "invalid_choice");
    assertInvalid(validateChoiceValue("foreign-option", optionIds), "invalid_choice");
    assertInvalid(validateChoiceValue(1, optionIds), "invalid_type");
    assertInvalid(validateChoiceValue("option-a", ["option-a", "option-a"]), "invalid_configuration");
    assertInvalid(validateChoiceValue("option-a", []), "invalid_configuration");
  });

  test("boolean is strict and does not coerce truthy values", () => {
    assert.deepEqual(validateBooleanValue(true), { ok: true, value: true });
    assert.deepEqual(validateBooleanValue(false), { ok: true, value: false });
    assertInvalid(validateBooleanValue("true"), "invalid_type");
    assertInvalid(validateBooleanValue(1), "invalid_type");
  });

  test("date accepts canonical real calendar dates only", () => {
    assert.deepEqual(validateDateValue("2024-02-29"), { ok: true, value: "2024-02-29" });
    assert.deepEqual(validateDateValue("2000-02-29"), { ok: true, value: "2000-02-29" });

    for (const value of ["2025-02-29", "1900-02-29", "2025-02-30", "2025-13-01", "2025-1-01", "0000-01-01"] as const) {
      assertInvalid(validateDateValue(value), "invalid_date");
    }
    assertInvalid(validateDateValue(new Date()), "invalid_type");
  });
});

describe("field dispatch and required values", () => {
  test("optional missing fields become null while required fields fail", () => {
    assert.deepEqual(validateFieldValue({ type: "number" }, undefined), { ok: true, value: null });
    assertInvalid(validateFieldValue({ type: "number", required: true }, null), "required");
    assertInvalid(validateFieldValue({ type: "text", required: true }, "   "), "required");
  });

  test("dispatches each field definition without coercion", () => {
    assert.deepEqual(validateFieldValue({ type: "text", maxLength: 4 }, "goa"), { ok: true, value: "goa" });
    assert.deepEqual(validateFieldValue({ type: "number", step: 2 }, 4), { ok: true, value: 4 });
    assert.deepEqual(validateFieldValue({ type: "rating" }, 4.5), { ok: true, value: 4.5 });
    assert.deepEqual(validateFieldValue({ type: "choice", optionIds: ["yes"] }, "yes"), { ok: true, value: "yes" });
    assert.deepEqual(validateFieldValue({ type: "boolean" }, false), { ok: true, value: false });
    assert.deepEqual(validateFieldValue({ type: "date" }, "2027-01-01"), { ok: true, value: "2027-01-01" });
  });
});

describe("CSV formula injection guard", () => {
  test("prefixes spreadsheet formula and control-character payloads", () => {
    for (const dangerous of [
      "=1+1",
      "+SUM(A1:A2)",
      "-2+3",
      "@cmd",
      "   =HYPERLINK(\"https://evil.test\")",
      "\tformula",
      "\rformula",
      "\nformula",
    ] as const) {
      assert.equal(guardCsvFormula(dangerous), `'${dangerous}`);
    }
  });

  test("preserves ordinary text and quotes CSV cells after guarding", () => {
    assert.equal(guardCsvFormula("A avaliação foi ótima"), "A avaliação foi ótima");
    assert.equal(guardCsvFormula("1-2"), "1-2");
    assert.equal(escapeCsvCell('=1+1,"filme"'), '"\'=1+1,""filme"""');
  });
});
