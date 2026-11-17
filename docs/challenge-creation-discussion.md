# Creation and logging: design discussion

The current creator uses **List** (answer once per item) and **Daily check-in** (new answers over time). Lists choose a library; daily check-ins can optionally use one and support several items per check-in. Deadlines remain independent. Manual and guided creation share these choices. See [the current change report](challenge-creation-v2.md).

The notes below preserve the earlier discussion and remaining logging questions. The former sheet/column interface was superseded; the logging/results flows remain in place.

## What the code currently does

Creation treats “uses library items” and “daily check-in” as opposing paths. Inside the library path it then asks whether to record one response per item or a session with several items. The latter creates an internal dated parent record and exercise records below it. It also adds a day-level comment and asks for a session name.

That mixes three independent questions: where items come from, whether a response repeats over time, and what values are recorded. An exercise library should not force the user to understand named sessions.

The database already stores an entry date separately from configurable fields. The calendar uses that entry date. A custom date question is another value and does not automatically control calendar placement or repeated-entry rules.

## Simpler model to discuss

A challenge defines the fields people record. It can use a library, and it can allow repeated, dated entries.

| Use | Library | Recording |
| --- | --- | --- |
| Movies/books to rate | Films/books | A response for each item; a date can be optional. |
| Workout | Exercises | Pick a date, select exercises, fill the fields for each. |
| Daily habit or journal | None | Pick a date and check in; extra questions are optional. |

In a sheet view a workout could show Date, Exercise, Weight, Reps 1, Reps 2, and Reps 3. The calendar would be another view of those dated records. Selecting several exercises would add several rows sharing the date, filled together in one form. It would not create new property definitions or require naming a session.

“How was it?” can be an optional note. It must not stand in for the configured numeric fields or be added as a mandatory question. Day-level notes and per-exercise comments have different scopes, so one must not be silently copied to every exercise row.

## First core change to consider

Make library selection independent of dated logging in creation, and remove the separate “session with several items” decision for the ordinary workout path. A dated log with a library can accept multiple selected items naturally. Existing internal date-group IDs can remain for compatibility while the user-facing setup becomes simpler.

Do not make every list dated. A movie rating need not become a repeated daily response, and dated book progress can coexist with item review/completion.

## Questions to settle before changing persistence

- Does a date group one activity, or can there be separate activities on the same date? Existing records already allow the latter and must remain accessible.
- Does a note describe the whole date/activity or one exercise? Avoid injecting an extra default field before deciding its scope.
- Are working sets fixed configured fields, explicitly repeated records, or an optional choice? Preserve existing data and avoid adding repeat buttons automatically.
- What does “check in” mean when there are no questions: a saved attendance record? It should not require invented text.
- When is a date optional, required, or automatically today? Use the same stored date for the sheet and calendar.
- A completion target and a performance comparison are independent features. Neither follows merely from numeric fields or library properties.

A first implementation should adjust one creation decision and its compatibility mapping, with examples and a review before redesigning logging or results.
