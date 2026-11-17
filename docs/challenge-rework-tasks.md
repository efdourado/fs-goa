# Challenge rework: inventory and staged tasks

Status: the app is based on `b9c9bf1` (2026-11-12), with Manage → Edit, The idea → About, and separately requested compatible dependency/runtime upgrades applied on `main`. A narrow repair restores existing exercise fields and protects them from the unrelated goal toggle. Manual/chat creation now uses List and Daily check-in, with an optional library on check-ins. Creation actions show locked/unlocked readiness. Stages are ordered groups with optional dates when the challenge has a deadline. The Results comparison revision and [combined Items/stages editor](items-stages-v1.md) are implemented; logging redesign remains pending. See [Results changes and limits](results-progress-v1.md). See [the current change report](challenge-creation-v2.md).
Historical recovery source: `3151183` (the temporary `recovery/2026-11-17-challenge-flow` branch is retired after the reviewed changes are pushed).

- `3375e52`: the original combined progress/UI/tooling commit from November 17.
- `3151183`: the preserved follow-up edits, including the attempted flow repair.

Recover individual changes in small commits. Do not cherry-pick the entire combined commit.

## Inventory: original commit `3375e52`

1. Show every selected numeric property in Results instead of keeping only the strongest percentage.
2. Keep individual properties visible alongside an optional workload formula.
3. Compare the latest logged performance with the starting performance; keep personal bests separately.
4. Add comparison rules: higher is better, lower is better, closer to a chosen value, or descriptive change without ranking.
5. Add comparable-context results: reps at the same weight, time at the same distance, etc.
6. Identify working sets/attempts by an explicit numeric property, rather than matching rows by position.
7. Add repeated-record and working-set controls to logging; select among multiple logs on the same date.
8. Apply the comparison rules to previous values, live deltas, and personal-best badges in the logging form; exclude future records when editing older dates.
9. Group Results by item/person and working set. Show start/latest values, sample counts, changes, personal bests, and a clickable property history with its comparison context.
10. Offer numeric-property record results for daily logs as well as multi-item workouts.
11. Validate comparison fields, context fields, set identifiers, and formula compatibility on the server. Remap their IDs when copying a challenge.
12. Move workout entry from the modal into the Today page, under the calendar. Done flushes pending saves.
13. Harden automatic saving: separate drafts by day and log identity, restore drafts, reuse returned IDs, queue saves, retry failures, and wait for pending saves when switching dates. Autosave itself existed before this commit.
14. Introduce a shared Save button: closed lock when unavailable, open lock when ready. Apply it to challenge entry, settings, dialogs, account, group, library, and related saves.
15. Check required/custom fields before allowing Save, including whitespace, dates, numeric limits, choices, and valid zero/false values. Coordinate readiness across combined response forms.
16. Make clearing an existing required answer visibly change the action to Delete, rather than displaying it as an ordinary Save.
17. Add bordered form containers, muted result backgrounds, subtle Today backgrounds, stronger input borders, and a full-width Done button.
18. Replace the personal-record row's hover decoration/arrow with an opacity change.
19. Rename the English page/navigation label “The idea” to “About”.
20. Add five progress demos: one working set, three working sets/workload, running, study, and gardening with a target value. Include a local seed command and instructions.
21. Upgrade the dependency/runtime set, Docker image, CI actions, lockfile, and related type tooling. These are historical versions from that commit, not a recommendation to install them unchanged now.
22. Document normal Docker startup, rebuilds, persistent volumes, localhost:3000, and development with automatic reload.
23. Add/update unit, UI-interaction, validation, comparison, copy, and API regression tests for these behaviors.

## Inventory: preserved follow-up work `3151183`

1. Rename challenge “Manage” to “Edit” in English, Portuguese, and Spanish. URLs remained compatible.
2. Use the subtle Today surface on “Your response” and shared-response boxes; keep green badges with normal light/dark text. Avoid unnecessary nested form borders.
3. After Done succeeds, hide the workout's action row and show an edit lock. Reopening edits the existing record. Failed saves remain editable.
4. Distinguish repeating the same exercise from adding a different item. Show the repeat action only once per exercise. A later revision removed ordinary repeats and retained only explicitly configured working sets.
5. Put Cancel before Save/confirmation actions; move the planner's cancellation action to the left of its choices.
6. Restore response headings above field labels, align the edit lock with the heading, and remove the decorative left border/floating lock treatment.
7. Put Delete left of Done, with equal widths filling the row. Remove “Today's Session”; retain the saved-state/edit-lock control.
8. Make an odd final participant occupy the whole remaining row in creation and editing.
9. Replace ordinary response-group names with generic labels, distinguish the day's details from exercise fields, remove the session-name question, and keep custom names for shared responses where they identify a real group answer.
10. Attempt to repair the exercise/goal mix-up: show exercise fields by default, identify only the dedicated optional goal log as goal tracking, and keep primary page/distance fields editable.
11. Protect goal changes/deletion on the server: preserve exercise records and primary fields; require confirmation for saved goal entries; check the expected record count; update the confirmation if the count changes.
12. Require an explicit goal-property choice instead of automatically picking the library's first number.
13. Hide unsupported shared-response and stage controls in the workout editor; reject incompatible goal/shared-response additions through the API.
14. Add flow, creation, goal-deletion, and data-preservation regressions and a flow-review document. The repair was tested, but the complete experience was rejected and rolled back.

## Execution rules

- [ ] One small, reviewable change per step/commit. State exactly which behavior changed.
- [ ] Inspect that step in light/dark mode and narrow/wide layouts where relevant; do not claim a visual browser check from markup tests alone.
- [ ] Keep UI labels separate from validation, persistence, calculations, dependency updates, and data changes.
- [ ] Preserve field IDs, saved values, library links, dates, ownership, and existing records.
- [ ] Test data only in a disposable test database or clearly identified demo challenges.
- [ ] Treat recovery-branch tests/results as historical evidence; verify each recovered change on the current baseline.

## Step 1 — small visual changes

Implement individually, starting with the first item:

- [x] Rename challenge Manage → Edit; preserve navigation URLs.
- [x] Rename The idea → About in English.
- [ ] Fill the final participant row when there are 1, 3, 5, etc. participants.
- [ ] Keep Cancel to the left of the affirmative action.
- [x] Use opacity-only hover on clickable personal-record rows; no green hover or chevron.
- [ ] Give Results/response forms a modest background while keeping every input border readable.
- [ ] Keep green badges with normal theme-aware text.
- [ ] Fix title/field/lock alignment and remove the stray left border, while retaining meaningful labels.

Acceptance: these commits do not change fields, saves, results, or challenge structure.

## Step 2 — properties and goal safety

This comes before restructuring creation or improving result math.

- [x] Exercise fields remain visible and editable; the optional daily comment does not replace them.
- [ ] Separate performance comparison from progress toward a finishing goal.
- [x] Identify the optional goal log explicitly; never use the general `progress` purpose alone to select data for hiding or deletion.
- [ ] Do not enable a goal just because a workout contains numeric fields or its library has numeric properties.
- [ ] Make destructive actions identify the affected field/type and saved records. Confirm on the server and preserve unrelated answers.
- [ ] Regression-check existing workouts, page-count reading, ratings, shared answers, and fixed numeric goals.

Acceptance: existing fields/values survive every unrelated settings change, including hostile or stale API requests.

## Step 3 — NEW: several items versus daily check-in

Creation is implemented with List (once per item) and Daily check-in (new answers over time). Daily check-in optionally uses a library and can record several selected items. See [the current report](challenge-creation-v2.md). The remaining work below concerns logging and progress, not another creation redesign.

Original problem: a workout required Item list → “session with several items”, then exposes a calendar/check-in structure and a session name. The creation choices do not describe the user's task clearly.

Proposed user-facing model to review before implementation:

| Choice | Normal flow |
| --- | --- |
| Item list | Choose a library item, then review, rate, or mark it complete. |
| Daily log | Choose a date and fill the configured fields. Optionally attach a library and choose one or several of its items for that date. |
| Optional finishing goal | Explicitly configure a fixed target or an item's numeric library property, independently of the two flows above. |

Workout example: Daily log → Exercises library → several exercises → configured weight/repetition fields. No session-name question. The date groups the exercise records internally.

- [x] Replace the separate “several items” creation choice with List / Daily check-in, with an optional library on check-ins.
- [x] Keep library selection independent of dated recording, within the existing logger contracts.
- [ ] Keep review/completion lists usable, including optional dated reading progress.
- [ ] Decide how multiple logs on one date should appear. Moving the UI option must not silently impose one record per day or erase existing same-day workouts.
- [ ] Separate exercise fields from optional details for the whole date; use generic labels that explain their scope.
- [x] Remove the session-name question from both creators and use a neutral internal entry label for new challenges.
- [ ] Audit stages, shared responses, expectations, and goals against each logging mode. Hide or reject unsupported combinations.
- [ ] Preserve existing challenges through compatibility mapping; avoid destructive conversion or ID changes.
- [ ] Test creation → activation → date selection → item selection → field entry → edit → history/results for every supported combination.

Recommendation: offer several items as a Daily log choice in the creation UI, while preserving the underlying separation between library items and dated activity. Do not globally remove dated progress from item lists.

## Step 4 — saving and workout interaction

- [ ] Decide inline form versus current modal after Step 3's flow is clear; do not recover the inline editor automatically.
- [ ] Agree on what autosaves and what Done means; show the state plainly.
- [x] Apply closed/open lock icons to primary confirmation actions (Save, Done, Continue) with opaque grey disabled backgrounds. Edit, minimise and other ordinary controls keep their original icons and colours. Existing validation and deletion behavior are preserved; see [button states](button-states.md).
- [ ] Keep saved/locked and editing states consistent; test failed saves and reopening the existing record.
- [ ] If inline is chosen, place Delete left of Done and let the pair fill the row; remove redundant session headings.
- [ ] Define fixed set fields versus repeated set records. Do not add “another record” to ordinary workout forms by default.
- [ ] Allow a set to remain empty only when its configured fields are optional; keep missing distinct from zero.
- [ ] Check offline/local drafts, multiple logs on one day, rapid saves, switching dates during a request, and duplicate-record prevention.

## Step 5 — results, recovered incrementally

- [x] First show every selected property independently; stop reducing the overview to the largest percentage.
- [x] Label starting, previous, latest, and personal-best values distinctly. Agree on which pair each percentage compares.
- [x] Then add higher/lower/descriptive comparison directions.
- [x] Then add contextual comparisons: more reps at the same weight; faster time at the same distance. Do not imply that dropping weight alone is an improvement.
- [x] Avoid redundant contextual rows when they communicate exactly the same comparison as the ordinary row.
- [x] Keep workload optional and show its factors alongside it. Do not assume different units can be condensed into a universally meaningful score.
- [x] Add separately identified working-set comparisons only after the set model is settled. Never match sets by row order.
- [x] Distinguish “closer to a desired measurement” from completion of a book/distance goal.
- [x] Test missing values, zero baselines, lower values, ties, historical edits, mixed units, partial sets, and multiple participants.
- [x] Validate field ownership, formula compatibility, and copy/remapping behavior on the server.

## Step 6 — demos and tooling as separate work

- [ ] Reintroduce representative demos only after each supported flow is agreed: fixed workout fields, explicit sets if retained, running, book progress, study, ratings/shared answers, and a plain daily habit.
- [ ] Review the dependency/Node/Docker/CI upgrade independently. Recheck compatibility and actual available versions when doing that work.
- [ ] Restore useful Docker daily-use documentation separately from package updates.
- [ ] Run the full component/API suites and production checks once the recovered pieces are integrated.
