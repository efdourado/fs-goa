import assert from "node:assert/strict";
import test from "node:test";
import {JSDOM} from "jsdom";
import {ArrowRightIcon, Button, CreationButton} from "../app/goa/ui";
import {StateButton} from "../app/goa/state-button";
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
 const dom = new JSDOM(renderWithIntl(<><CreationButton disabled>Continue</CreationButton><StateButton readiness type="submit" aria-label="Add" disabled><svg aria-hidden="true" /></StateButton></>));
 try {
  const [creation,compact] = dom.window.document.querySelectorAll('button');
  assert.equal(creation.querySelectorAll('[data-lock-state]').length,1);
  assert.equal(compact.getAttribute('aria-label'),'Add');
  assert.equal(compact.getAttribute('data-replace-icon'),'true');
 } finally {dom.window.close();}
});
test('fieldset-disabled actions carry a lock indicator and choice controls retain their semantics', () => {
 const dom = new JSDOM(renderWithIntl(<fieldset disabled><Button>Save</Button><StateButton role="switch" aria-checked="false" disabled={false}>Required</StateButton></fieldset>));
 try {
  const [action,choice] = dom.window.document.querySelectorAll('button');
  assert.equal(action.matches(':disabled'),true);
  assert.ok(action.querySelector('.goa-readiness-marker'));
  assert.equal(choice.getAttribute('role'),'switch');
  assert.equal(choice.getAttribute('aria-checked'),'false');
  assert.equal(choice.getAttribute('data-choice'),'true');
  assert.equal(choice.querySelector('.goa-readiness-marker'),null);
 } finally {dom.window.close();}
});

test('primary actions keep an open lock when available, including Done without a disabled prop', () => {
 const dom = new JSDOM(renderWithIntl(<fieldset disabled={false}><Button>Done</Button></fieldset>));
 try {const button=dom.window.document.querySelector('button')!;assert.equal(button.getAttribute('data-readiness'),'true');assert.equal(button.matches(':disabled'),false);} finally {dom.window.close();}
});

for (const disabled of [false,true]) {
 test(`editing, minimising and secondary controls never acquire locks: disabled=${disabled}`, () => {
  const dom = new JSDOM(renderWithIntl(<fieldset disabled={disabled}>
   <StateButton disabled={disabled} aria-label="Edit"><svg aria-hidden="true" /></StateButton>
   <StateButton disabled={disabled} aria-label="Minimise"><svg aria-hidden="true" /></StateButton>
   <Button variant="secondary" disabled={disabled}>Cancel</Button>
   <Button variant="danger" disabled={disabled}>Delete</Button>
   <StateButton disabled={disabled} className="bg-[var(--main)]" aria-label="Open add field"><svg aria-hidden="true" /></StateButton>
  </fieldset>));
  try {
   for (const button of dom.window.document.querySelectorAll('button')) {
    assert.equal(button.querySelector('.goa-readiness-marker'),null);
    assert.equal(button.getAttribute('data-readiness'),null);
    assert.equal(button.matches(':disabled'),disabled);
   }
  } finally {dom.window.close();}
 });
}
