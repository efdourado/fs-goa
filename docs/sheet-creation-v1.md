# Sheet-based creation — first version

Superseded by [the List / Daily check-in revision](challenge-creation-v2.md). This document records the first version for reference.

This report covers the creation work in this step. The earlier label changes, dependency upgrades, and narrow workout-field repair remain separate work already present on `main`.

## Scope

Both the manual creator and guided/chat creator now describe a sheet. Existing challenges, entry editing, logging screens, calculations, rankings, and history were not redesigned or migrated. The existing storage shapes are used for new sheets.

Two additive server creation options were needed to avoid reintroducing hidden defaults. They do not alter old clients' defaults.

## Every user-facing change

1. Replaced the initial List / Daily check-in cards with one sheet setup.
2. Added an optional “Link rows to a library” choice. A library supplies items rather than choosing what the challenge measures.
3. Added a separate “Record by date” choice. With a linked library it can be turned off for one response per item, or on for repeated dated records.
4. Removed the separate “one session with several items” choice. Dated library logging already accepts several selected items through the existing logger.
5. Removed the session-name question. New dated library groups get a neutral Entry label internally.
6. Stopped deriving fields and recipes from a library being films, books, exercises, or another subject. Library type no longer inserts ratings, weight, pages, or a finishing goal in these creators.
7. Start with one optional text column, Value. It can be renamed and have its type changed. The existing column tools support text, numbers, ratings, choices, yes/no, and dates, with their normal settings.
8. Add, remove, and reorder columns using the existing field editor, with creation-specific “Column / Add column” labels. Existing field-editor callers retain their old labels.
9. Added a header preview showing the built-in date, linked item when applicable, and configured columns. Date/item information does not replace user-defined columns.
10. Switching source/date choices keeps entered columns, title, rules, and schedule. Temporarily unlinking a library also keeps its selected items in the draft so they can be restored. Choosing a different library clears incompatible selected items, not the columns.
11. New dated library sheets omit the automatic day-level “How was it?” field. A note can be an explicit column instead. Existing challenges and old creation requests keep their notes.
12. New primary entry types use the creator's localized “Your response” label instead of a subject-specific response name.
13. Existing libraries and creating a library remain available. Empty built-in film/book library suggestions are no longer promoted by these creators.
14. One-response-per-item sheets still offer individual versus shared ownership for the configured columns. Dated rows remain individual; the setup explains this.
15. Removed subject-specific expectation/reveal questions from new creation. Rating fields can still be explicitly configured. Existing challenges retain their expectations/reveal settings.
16. New sheets use explicit names. The chat no longer suggests a name from library + year.
17. The chat now asks: destination → source/date behavior → columns → name → linked items when applicable.
18. The chat uses the same source and column components as manual creation.
19. The chat's linked-item step now uses the existing generic library item editor, allowing multiple initial items and their library properties, rather than a hardcoded first-title/book-author pair.
20. Preserved personal destinations, existing group destinations, and new-group creation in the chat. Existing group participant selection remains in manual creation.
21. Preserved manual descriptions, rules, optional fixed periods, linked-item editing, participant selection, and save/discard-draft handling.
22. Renamed the manual field step to Columns and its library step to Linked items. The no-fixed-period hint now uses neutral wording.
23. Added English, Portuguese, and Spanish copy for all new controls and explanations.

## Saved drafts

- New drafts store explicit sheet/date/library choices, alongside the existing compatible fields.
- Older drafts derive their initial choices from their saved structure and recording mode. Their columns are retained.
- Old progress drafts retain their existing recipe until the creator changes source/date configuration. The form explains this.
- Separate response groups in an old draft remain visible and editable/removable. A switch to an incompatible dated/unlinked mode is blocked until those groups are explicitly removed or the compatible mode is restored.
- New creation focuses on one column group. It does not offer the old “add another response form” control. Shared ownership applies to the entire column group; per-column mixed ownership is not implemented.

## Storage and request compatibility

| Setup | Existing contract used |
| --- | --- |
| No library | `habit`: one dated entry per participant/day |
| Library, dates off | `custom` + `single`: one response per item, individual or shared |
| Library, dates on | `custom` + `session`: dated group plus records for selected items |

The helper that builds this mapping is shared by both creators. No recipe/schema migration was introduced.

Additive request fields:

- `responseName?: string`: a validated, nonblank name of at most 120 characters for the new primary response type.
- `includeSessionNote?: boolean`: `false` leaves the new dated group's fields empty; omitted retains the previous automatic note.

Both options pass through the shared request-body mapper. The false note flag is preserved rather than accidentally omitted. The shared recipe key for legacy goal tracking and the earlier goal/exercise safety fix remain unchanged.

## First-version limits

- Without a library, dates are required and the current logger supports one entry per participant/day. Arbitrary undated free rows or multiple unlinked rows per day need a later logging change.
- With a library, dates off means one response per item, not freely repeatable undated rows. Dates on retains the existing support for several activities on the same day.
- The header table is a preview. Recording still uses the existing Today/modal forms; this is not a new editable grid or formula engine.
- At least one configured column remains required by the current creation/activation flow. The initial Value column is optional, so an entry can still be saved with its optional value blank.
- Library item constraints remain: a library may require properties such as an author. The generic library editor continues handling those constraints.
- No goals or ranking fields are inferred. A rating's explicit “counts for ranking” setting and later result settings retain their current behavior.
- No new advanced mixed-response-group control, automatic sealed ratings, or automatic estimate-before-rating step is exposed. These are possible future generic options, not effects of choosing a library.

## Verification

- Typecheck passed.
- Unit/component suite passed (38 test files).
- Eleven creation interaction tests passed, covering both creators, all supported date/library combinations, changing choices without losing columns, legacy list/progress drafts, shared ownership, and new-group creation.
- Full isolated API suite passed (165 tests), including old-client compatibility, new opt-in metadata validation, activation and saving through existing logger contracts, and workout-field protection.
- ESLint passed with the existing unrelated image-performance warning in `app/goa/ui.tsx`.
- Docker production build/start passed; app remains on `main` at port 3000.
- Manual and guided creators inspected in the browser using the existing local development account. Preview forms were left unsaved; no live sheet was created for testing.
- Browser screenshots captured at the normal desktop viewport. Narrow-screen behavior was not manually inspected.

## Files changed in this step

- `app/goa/screens/create-challenge.tsx`: manual sheet wizard and legacy-draft handling.
- `app/goa/screens/quick-create.tsx`: guided sheet creation and generic initial-item editor.
- `app/goa/sheet-creation.ts`: shared defaults and storage-mode mapping.
- `app/goa/sheet-source.tsx`: shared optional-library/date controls.
- `app/goa/sheet-columns.tsx`: shared column builder and header preview.
- `app/goa/fields.tsx`: optional creation-specific Add-column labels; defaults retained elsewhere.
- `app/goa/challenge-draft.ts`: optional saved sheet choices.
- `app/goa/types.ts`, `app/goa/challenge-request.ts`: opt-in creation fields and serialization.
- `lib/goa/challenges/recipes.ts`, `lib/goa/domain/challenges.ts`: validate and apply those creation options.
- `messages/en.json`, `messages/pt-BR.json`, `messages/es.json`: new copy.
- `tests/sheet-creation.test.tsx`, `tests/challenge-request.test.ts`, `tests/integration/mvp.test.ts`: regressions.
- Creation discussion/task documents: record the first-version outcome and remaining work.
