import assert from "node:assert/strict";
import test from "node:test";
import {JSDOM} from "jsdom";
import {ArrowRightIcon, Button, CreationButton} from "../app/goa/ui";
import {StateButton, StateFieldset} from "../app/goa/state-button";
import {renderWithIntl} from "./helpers/intl";

for (const disabled of [true,false]) {
 test(`shared actions expose the native disabled state and correct lock: ${disabled}`, () => {
  const dom = new JSDOM(renderWithIntl(<Button disabled={disabled}>Save<ArrowRightIcon /></Button>));
  try {
   const button = dom.window.document.querySelector('button')!;
   assert.equal(button.disabled,disabled);
   assert.equal(button.textContent,'Save');
   assert.equal(button.querySelectorAll('[data-lock-state]').length,1,'replace the old arrow with one readiness indicator');
   assert.equal(button.querySelector('[data-lock-state]')!.getAttribute('data-lock-state'),disabled?'locked':'unlocked');
  } finally {dom.window.close();}
 });
}
test('creation uses the same single indicator and compact actions keep their accessible names', () => {
 const dom = new JSDOM(renderWithIntl(<><CreationButton disabled>Continue</CreationButton><StateButton type="submit" aria-label="Add" disabled><svg aria-hidden="true" /></StateButton></>));
 try {
  const [creation,compact] = dom.window.document.querySelectorAll('button');
  assert.equal(creation.querySelectorAll('[data-lock-state]').length,1);
  assert.equal(compact.getAttribute('aria-label'),'Add');
  assert.equal(compact.getAttribute('data-replace-icon'),'true');
 } finally {dom.window.close();}
});
test('fieldset-disabled actions carry a lock indicator and choice controls retain their semantics', () => {
 const dom = new JSDOM(renderWithIntl(<StateFieldset disabled><StateButton type="button">Save</StateButton><StateButton role="switch" aria-checked="false" disabled={false}>Required</StateButton></StateFieldset>));
 try {
  const [action,choice] = dom.window.document.querySelectorAll('button');
  assert.equal(action.matches(':disabled'),true);
  assert.ok(action.querySelector('.goa-readiness-marker'));
  assert.equal(choice.getAttribute('role'),'switch');
  assert.equal(choice.getAttribute('aria-checked'),'false');
  assert.equal(choice.getAttribute('data-choice'),'true');
 } finally {dom.window.close();}
});

test('actions inside an available fieldset keep the open-lock state after a request finishes', () => {
 const dom = new JSDOM(renderWithIntl(<StateFieldset disabled={false}><StateButton>Save</StateButton></StateFieldset>));
 try {const button=dom.window.document.querySelector('button')!;assert.equal(button.getAttribute('data-readiness'),'true');assert.equal(button.matches(':disabled'),false);} finally {dom.window.close();}
});
