# Results: independent measurements and comparable history

This revision changes Results and its calculation settings. Challenge creation, field definitions, the calendar, logging controls, entry cardinality and autosave are unchanged.

## What changed

1. The progress page identifies every tracked numeric field by name and unit, grouped by item and participant. An unchanged weight does not hide improving repetitions.
2. The main comparison is **start → latest**, with the first and latest valid logged values for that measurement. It no longer presents the all-time best as the latest result or promotes the largest percentage in a headline.
3. Each measurement opens its own history: latest, previous, personal best (where meaningful), starting value, change since start, session count, full-history chart and the existing latest-five-session list.
4. Workload remains explicit and optional. Selecting it shows the formula plus its individual component fields. Summing workload across separately logged sets does not also add their kilograms together; individual components keep their own best record within the session in workload mode.
5. Comparison rules support higher, lower, descriptive change, and proximity to an explicitly chosen reference value. The last option also preserves existing saved reference-value settings. These rules do not create completion goals.
6. An optional same-value comparison supports, for example, reps at the same weight or time at the same distance. It follows the latest recorded context and compares only matching earlier contexts, including when returning to a lighter weight. A first observation at a new weight says it has no comparison yet.
7. Identical raw/context histories are merged rather than showing the same information twice. Unfiltered field history stays available when the contextual history differs.
8. Existing fixed columns such as Reps 1, Reps 2 and Reps 3 remain separate histories. No fields are renamed, added or inferred from their labels.
9. An optional existing numeric set/attempt identifier can separate repeated-record histories by set. Record order is never used as a set identity. Missing sets remain missing. This setting does not add repeat buttons or change the logging form.
10. With an explicit set identifier and summed workload, per-set workload and total recorded workload are both available. The total includes only logged sets.
11. Missing, whitespace and boolean values are excluded from numeric comparisons. An actual zero remains zero; a zero starting value uses absolute change instead of an invented percentage. An incomplete workload formula does not hide the remaining valid individual measurements.
12. Comparison direction also controls best-record selection, chart markers and history-change colors. Descriptive fields do not get personal-best awards. Latest personal-best badges require an actual improvement over preceding observations. Declines are labelled as declines.
13. Numeric daily check-ins without libraries can use the same progress settings and Results page. Their item grouping is presentation-only; nothing is inserted into the library or challenge items. Rating/list results retain their existing path.
14. Comparison settings validate numeric field ownership, contexts within the same response type, formula factors within the same response type, and the source of an explicit set identifier. Copying a challenge remaps rule keys, context references and set identifiers to the copied fields.
15. Clickable measurement rows use opacity-only hover with no arrow or hover background. Item groups use the existing muted theme surface.
16. English, Portuguese and Spanish labels/help describe the new calculations and keep consistency-goal settings separate.

## Examples

| Recorded values | Result |
| --- | --- |
| 50 kg × 8 → 50 kg × 10 | Weight stays at 0%; reps improve 25%. Optional workload goes from 400 to 500. |
| 40 kg × 10 → 60 kg × 6 → 40 kg × 15 | At 40 kg, reps compare 10 → 15 (+50%), without comparing that row against the 60 kg attempt. |
| 50 → 60 → 55 kg | Latest is 55; best is 60; change since start is +10%. |
| Reps 1/2/3 stored in separate fields | Every configured field has its own baseline, latest value and history. |
| Separately stored set identifiers 1/2/3 | Each identifier has its own history even when records arrive in a different order. |
| 32 → 29 minutes, lower is better | Latest 29; best 29; 9% improvement. |

## Where to configure it

Edit challenge → Results → edit “Progress and personal bests.” Select the numeric fields, choose whether to add workload, and optionally choose a comparison direction/context per field. Set identification is under an optional disclosure.

## Limits

- Workload is a product of explicitly selected factors, optionally summed across existing records. It is not a universal fitness score or an estimated strength formula.
- A single field saying “3 sets” cannot reconstruct the weight/reps of each set. Multiply by a set count only when those sets have identical recorded weight and reps. Do not multiply Reps 1 × Reps 2 × Reps 3.
- Separate fixed set columns are supported individually; a formula summing several different field-pair products is not introduced here.
- Same-value context compares exact numeric values in the same configured field. It does not infer unit conversions or select context from field names.
- The existing session aggregation choice is retained. In separate mode, choosing “sum records” explicitly sums that field. In workload mode, only workload is summed; component measurements retain their best record.
- Existing once-per-item numeric lists are not converted into daily histories.
- No migrations or edits to existing records/settings are performed. Existing challenges recalculate their Results when opened, using their saved choices or the existing defaults.

## Validation

- 23 calculation/settings tests and 5 interactive Results tests pass.
- All 39 unit/component test files pass.
- Full isolated API suite: 166 passing tests, including actual saved workout data remaining identical through settings changes and rejected requests, context validation, and copying field references.
- TypeScript, lint for changed files and production Docker build pass.
- Existing dated workout Results and the measurement-history dialog inspected in the desktop browser. No existing challenge or record was saved during browser review.
