# Challenge creation: lists and daily check-ins

This revision replaces the sheet-based creation interface from [version 1](sheet-creation-v1.md). It keeps the existing persistence and logging contracts.

## Choices people make

| Choice | Meaning | Library |
| --- | --- | --- |
| List | Answer the configured questions once for each item. Saved answers can be edited. | Choose a library below the List / Daily check-in choice. |
| Daily check-in | Record new answers over time. Previous dates keep their answers. | Optional. With a library, choose one or several items in each check-in and record the configured values for each. |

Repetition applies to the whole challenge. Questions do not individually switch between once-only and daily behavior in this version. A deadline does not determine repetition. An ordinary date question does not change the recording mode or replace the entry date used by the calendar.

## All changes in this revision

1. Restore two prominent choices: List (selected initially) and Daily check-in.
2. Show library selection directly below List. Daily check-in offers an optional “Use a library” switch in the same place.
3. A fresh daily check-in starts without a library. Switching an already configured list to daily keeps its selected library and items; the library can be switched off without losing the draft items.
4. Remove the “Link rows to a library” and “Record by date” controls.
5. Keep the separate “One response per item / One session with several items” choice removed. Several items remain supported within a daily check-in that uses a library.
6. Replace user-facing sheet/column language with challenge, items, and questions/measures. Keep a neutral optional text field, “Your response,” as the starting editable question.
7. Remove the table-header preview entirely.
8. Restore the “New personal challenge” page heading. Replace the old preset-oriented subtitle with an explanation of List / Daily check-in.
9. Reorder manual creation: Challenge → Items (when using a library) → Response → Participants (group challenges).
10. Give the guided creator the same order after choosing personal/group: name, mode/library and optional deadline together; items when applicable; questions/measures; create.
11. Add optional start/end dates to the guided creator. Previously this version always submitted no deadline. Both creators now say “With a deadline / No deadline” so this choice is distinct from daily recording.
12. Explain the questions at their point of configuration: once per item, again each day, or per selected item in each check-in.
13. Continue, Create draft and guided Create group actions use the same closed/open lock icon and disabled state. Missing names, libraries, items, question labels or a valid date range keep the relevant action locked; saving also locks it.
14. Preserve configured questions, types, numeric settings, scope and selected draft items when switching recording mode or temporarily disabling the library. Changing to a different library clears incompatible item selections.
15. Preserve older progress drafts and their configured goals until their recording mode or library actually changes. Saving a draft now stores its semantic step, and older drafts resume the corresponding step after reordering.
16. Keep list individual/shared response choices, manual rules/descriptions, group participants, draft saving and old draft response groups. The compatibility restrictions from version 1 still apply.
17. Describe stages as ordered groups, such as “Horror movies” or “Phase 1.” New stage date inputs appear only when the challenge has an end date. Date-free stages do not show a redundant “no dates” line.
18. Preserve and expose previously stored stage dates even if the challenge deadline has since been removed. Editing a stage title does not clear those dates.
19. Update English, Portuguese and Spanish labels and hints.
20. Rename the shared creation components/helpers to match the challenge vocabulary; remove the no-longer-used column-label overrides from FieldRows.

## Persistence and limits

There are no new schema changes, migrations or edits to existing challenge definitions/records in this revision. A list still uses the existing once-per-item path. A daily check-in without a library uses the existing daily path (one entry per participant/date). A daily check-in with a library uses the existing parent/child record path, which already supports several selected items and multiple activities on the same date. Creation does not add a session-name prompt or an automatic day-level comment.

The two opt-in API metadata options introduced in version 1 remain in use. Results calculations, targets, working-set controls, the logging form and calendar behavior are unchanged by this revision. Library item properties and challenge response questions remain separate. Existing library validation still applies. Stage date visibility is an editor rule; historical/API records are not rewritten.

Older reading presets (`library` and `progress`) created two response types automatically: daily progress plus a separate completion/rating response. Renaming both to “Your response” did not combine them. Fresh custom creation uses the configured questions together; a multi-item daily check-in adds only an empty internal date container. Older progress drafts retain their original recipe for compatibility, and existing daily history and once-only ratings are not converted by these interface changes. Entry fields shows the configured fields together directly, with no additional response heading.

The Items step uses one round + at the far right of its heading, before and after items are added. Each item uses the standard sliders edit icon beside the remove icon, with equal button and glyph sizes. The guided creator uses the same item controls. Opening Add again starts an empty selection rather than reusing the previously submitted draft.

## Verification

- 17 direct interaction tests cover the three recording paths, closed/open lock transitions, name/library/items/question/date requirements, mode switching, shared answers, new-group destination, old progress drafts, resumed step migration, and stage dates/history.
- All 38 unit/component test files pass.
- Three isolated API regressions pass: existing workout property protection, all three creation modes with actual saves, and opt-in metadata compatibility.
- TypeScript and production Docker build pass. Lint has no errors; the existing image-element warning remains in ui.tsx.
- Local application rebuilt on main at port 3000. Manual and guided creation inspected in the browser without saving a challenge.
