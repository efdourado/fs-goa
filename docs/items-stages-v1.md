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
- Show ordinary primary fields under the generic “Sua resposta” / “Your response” label. Keep check-in details distinguishable when they contain fields; hide empty parent groups. These are display changes, without renaming stored types or fields.
- Remove the separate add-shared-response button. The existing + field button opens one field modal with a shared/individual switch. New shared fields derive their internal response name from their question label; there is no second response-name prompt.
- Keep response-name inputs out of the response settings opened from Entry fields; retain confirmed response removal where available. Existing response data and identifiers are preserved.
- When adding an individual field while viewing shared fields, save it to the individual response. A failed field save preserves the modal draft.
- Shared creation is available on supported once-per-item lists. Daily/multi-item check-ins show the switch disabled with an explanation. The API also rejects adding a once-per-item shared response to a multi-item daily session, preserving its existing fields.
- Show the selected collection's actual count in the collapsed “Da coleção (89)” button when that collection contains items. Counts load from the existing scoped catalogue shelf endpoint and refer to that library, not every collection combined.
- Update English, Portuguese and Spanish text.

## Scope and compatibility

No migrations, field renaming, record conversion or changes to Results calculations were made for this revision. The existing item, stage and assignment APIs are reused. Existing shared responses remain accessible. Individual/shared scope is selected for a new field; saved answers are not converted between scopes. Daily shared-answer history is not introduced.

## Verification

- Thirteen interaction tests cover modal stage saves and failures, preserved date instants, item assignment, adding directly into a stage, collection counts, item editing/details, generic response labels, sharing, failed field saves, and progress availability for missing/hidden/visible numeric library properties.
- All 40 unit/component test files pass.
- Full isolated API suite: 168 tests pass. The added regression verifies item addition, stage assignment, property editing and saved-answer preservation, plus unsupported daily sharing rejection.
- TypeScript, lint for changed files and the production Docker build pass.
- Browser review on an existing local challenge verified the combined tab, expanded stage items, stage modal, generic response label, new-field sharing switch, and a real collection count. No challenge or record was saved during this review.

## Follow-up polish

- Remove decorative left borders from all response-form sections, including expectation and rating.
- Hide the supplementary Progress control when no eligible visible numeric library property exists, including while the properties load. Available progress remains off until explicitly enabled.
- Reject unsupported activation on the server, including legacy boolean requests and hidden native book-page properties. Existing stored fields/answers are preserved.
