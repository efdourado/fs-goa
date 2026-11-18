# Items, stages and response-field editing

## Changes

- Rename the editor tab and page to “Itens e etapas” / “Items and stages” / “Elementos y etapas.” Keep the existing `checkpoints` route key and links compatible.
- Show items grouped under expandable stages, with an unassigned section. Challenges without stages show a full items list. Existing stage order, item counts and duration totals remain visible.
- Add items with the round + on the right of the page title/description, open an item's existing property editor from its title, and retain the existing confirmed removal flow. Closed challenges open read-only item details.
- Offer a stage selector when adding items. The existing item API accepts `checkpointId`; no new persistence contract is needed.
- Give each stage a searchable item-selection modal. Selecting an item moves it into that stage; deselecting an assigned item leaves it in the challenge without a stage. The modal preserves selections hidden by its search filter.
- Offer a per-item stage-selection modal, including the unassigned option.
- Replace inline stage editing, “Editar etapa,” “Pronto,” and the page-level “Salvar etapas” button with the standard editing modal. Stage edits save from that modal. Failure keeps the draft open and editable.
- Keep title, description and optional dates in the stage modal. Preserve existing date instants when the date inputs are unchanged, including when only a stage title changes. Dates on other stages are sent unchanged.
- Move stage deletion into the modal's existing confirmed-delete pattern. Existing server protection for stages with saved records remains in force.
- Save stage reordering and existing distribute/shuffle actions immediately. Keep these unavailable on closed challenges and automatically generated calendar stages.
- Move the item-organising shortcut from General to the combined tab. Missing-item setup notices now point to the combined tab.
- Use neutral inherited text for the “required” label in Entry fields.
- Show all configured response fields together directly beneath the Entry fields title. Remove the extra “Sua resposta” / “Your response” heading and response-group tabs, including “Detalhes do check-in.” Keep shared fields identifiable with a field-level badge. Stored types, field IDs and existing answers are preserved.
- Remove the separate add-shared-response button. The existing + field button opens one field modal with a shared/individual switch. New shared fields derive their internal response name from their question label; there is no second response-name prompt.
- Remove the response-group settings/edit control and its dialog from Entry fields. Individual field editing and its existing confirmed removal remain available.
- Route each field edit and reorder to its original response type, even though all fields are visible together. New individual fields target the primary response. A failed field save preserves the modal draft.
- Shared creation is offered only on supported once-per-item lists. Daily/multi-item check-ins omit the option and its unavailable-state explanation entirely. The API still rejects unsupported shared creation, preserving its existing fields.
- Show the selected collection's actual count in the collapsed “Da coleção (89)” button when that collection contains items. Counts load from the existing scoped catalogue shelf endpoint and refer to that library, not every collection combined.
- Update English, Portuguese and Spanish text.
- Call the creation tab and field label “Resposta” / “Response” / “Respuesta” rather than “question or measure.”
- A single-item creation edit modal shows its inputs directly, with no nested bordered item card. Input borders and the normal modal shell remain.

## Scope and compatibility

No migrations, field renaming, record conversion or changes to Results calculations were made for this revision. The existing item, stage and assignment APIs are reused. Existing shared responses remain accessible. Individual/shared scope is selected for a new field; saved answers are not converted between scopes. Daily shared-answer history is not introduced.

## Verification

- Interaction tests cover modal stage saves and failures, preserved date instants, item assignment, collection counts, item editing/details, one combined response list, editing fields without changing their owners, shared-field routing, failed saves, generic daily-answer modal titles, and progress availability.
- All 359 unit/component tests and both production-render checks pass. TypeScript and the production Docker build pass; lint has no errors and retains the existing image-element warning.
- Full isolated API suite: 168 tests pass. The added regression verifies item addition, stage assignment, property editing and saved-answer preservation, plus unsupported daily sharing rejection.
- TypeScript, lint for changed files and the production Docker build pass.
- Browser review on an existing local challenge verified the combined tab, expanded stage items, stage modal, generic response label, new-field sharing switch, and a real collection count. No challenge or record was saved during this review.

## Follow-up polish

- Use “Respostas de hoje” / “Today’s answers,” dated answer titles and generic saved-entry labels in multi-item logging. Do not use stored workout/session names as UI headings, buttons or accessible names. Keep multiple logs on the same date supported.
- Remove decorative left borders from all response-form sections, including expectation and rating.
- Hide the supplementary Progress control when no eligible visible numeric library property exists, including while the properties load. Available progress remains off until explicitly enabled.
- Reject unsupported activation on the server, including legacy boolean requests and hidden native book-page properties. Existing stored fields/answers are preserved.

## Answer editing

- Individual responses have one right-aligned edit lock beside “Your response.” Editing shows an open lock in that position.
- Save is at the bottom with its normal closed/open readiness icon and grey/green states. The header lock acts as Cancel while editing: it discards unsaved changes and hides Save. There is no separate Cancel button. Unchanged answers keep Save disabled; only changed sections are submitted.
- Expectation and rating save independently, in either order. A rating no longer prevents creating or editing an expectation on the server. Existing answers, visibility rules and metric sources are preserved.

The participant schedule below the hero is titled “Stages,” independently of the “Items and stages” editor tab. It fills the available width: one column for one stage, three for multiples of three starting at six, and two otherwise. An odd last stage in a two-column layout spans the row. Narrow screens use one column.

Daily forms use “Sua resposta para hoje” / “Your response for today,” or the selected past date, with the usual response-heading styling. The same wording is used for reading counters and library check-ins. A form that owns its own heading suppresses the extra calendar day heading.

Closed challenges on Today use the same face-style empty-state component as the header Updates menu. A completed counter offers a standard bordered Correct button. Correction takes place in a modal, keeps failed edits available to retry, prevents closing while saving, and closes after a successful save or deletion.

Long item groups render 12 rows initially, with Show more revealing the next 12. Counts, assignment and organisation still use the complete challenge data. The correction modal has full-width mode choices and equal-width footer actions, with Remove entry on the left and Save on the right. Its number stepper stays compact and the extra divider above the mode choices is removed. Its edit icon sits beside the page total. Book page totals are enforced in the editor and API, including edits and concurrent check-ins, with no editions warning. Yesterday uses its own response label.

Overflow displays only a short page-limit message, suppressing the amount, resulting-page and percentage calculations. Saving remains blocked.

Stage cards below the hero all use the neutral past-stage appearance, with no Past/Current/Upcoming badge or green current-stage highlight. Reading percentages use the normal theme text colour, and the page correction icon has a pointer cursor.

Existing response fields can be removed even when they are the only field in an internal response group. An empty group is permitted; the dated check-in and its exercise records remain. The field editor names the field in its deletion confirmation. Saved answers to that field require the existing confirmation; metric and permission protections still apply.

Multi-item daily logs use the existing modal. Saved cards open their existing records for editing. Numeric progress uses the existing correction modal for every selected date, with a plus and “Log for today/yesterday/date” until completion and “Correct entry” afterward. Response forms keep Save visible while locked; only saved, nonempty answers have a header lock. Closing the lock restores the saved values. Emptying and saving the last answer removes the header lock and leaves the form ready to answer again. Save remains disabled for unchanged or incomplete new responses.

The multi-item daily response header offers the same green circular + used by Home, items and fields, only while the selected date has no saved answer. Answered dates open their existing records by clicking the saved card, with no New entry action. Existing records remain available. Saved cards emphasize each exercise and numeric value, with smaller field labels and text answers that wrap. Empty dates use the same face-style empty state as header Updates. The log modal is wider on desktop, with fields arranged horizontally. Its Done action fills the footer alone or shares equal width with Delete on the left. Each item’s Remove action is at its top-right.
