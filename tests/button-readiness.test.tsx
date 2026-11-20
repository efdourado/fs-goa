import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { ArrowRightIcon, Button, CreationButton, InlineSubmit } from "../app/goa/ui";
import { StateButton } from "../app/goa/state-button";
import { renderWithIntl } from "./helpers/intl";

for (const disabled of [true, false]) {
  test(`confirmation buttons keep their disabled state without lock icons: ${disabled}`, () => {
    const dom = new JSDOM(renderWithIntl(<>
      <Button disabled={disabled}>Save<ArrowRightIcon /></Button>
      <CreationButton disabled={disabled}>Continue</CreationButton>
      <InlineSubmit label="Add" disabled={disabled} />
    </>));
    try {
      const buttons = [...dom.window.document.querySelectorAll("button")];
      assert.deepEqual(buttons.map((button) => button.textContent), ["Save", "Continue", "Add"]);
      for (const button of buttons) {
        assert.equal(button.disabled, disabled);
        assert.equal(button.getAttribute("data-readiness"), "true");
        assert.equal(button.querySelector("svg"), null);
      }
    } finally { dom.window.close(); }
  });
}

test("icon-only actions retain their supplied icon and accessible name", () => {
  const dom = new JSDOM(renderWithIntl(
    <StateButton readiness type="submit" aria-label="Add" disabled>
      <svg aria-hidden="true" data-add-icon="" />
    </StateButton>,
  ));
  try {
    const button = dom.window.document.querySelector("button")!;
    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute("aria-label"), "Add");
    assert.ok(button.querySelector("svg[data-add-icon]"));
    assert.equal(button.querySelectorAll("svg").length, 1);
  } finally { dom.window.close(); }
});

test("fieldset disabling and choice semantics remain native", () => {
  const dom = new JSDOM(renderWithIntl(
    <fieldset disabled>
      <Button>Save</Button>
      <StateButton role="switch" aria-checked="false">Required</StateButton>
      <Button variant="secondary">Cancel</Button>
    </fieldset>,
  ));
  try {
    const [action, choice, secondary] = dom.window.document.querySelectorAll("button");
    assert.equal(action.matches(":disabled"), true);
    assert.equal(action.getAttribute("data-readiness"), "true");
    assert.equal(choice.getAttribute("role"), "switch");
    assert.equal(choice.getAttribute("aria-checked"), "false");
    assert.equal(choice.getAttribute("data-readiness"), null);
    assert.equal(secondary.matches(":disabled"), true);
    assert.equal(secondary.getAttribute("data-readiness"), null);
    assert.equal(dom.window.document.querySelector("svg"), null);
  } finally { dom.window.close(); }
});
