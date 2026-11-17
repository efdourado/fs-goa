# Button readiness

Primary confirmation actions (Save, Done, Continue and existing green confirmation buttons) use `StateButton` readiness. Native `disabled` remains the source of truth: blocked primary actions show a closed lock, an opaque neutral grey background and readable neutral text in both themes. Available primary actions show an open lock and their usual green.

Readiness is explicit; `disabled`, being inside a fieldset or having a green class never automatically adds a lock. Native fieldset disabling still closes the lock on primary actions during requests. Circular confirmation submit icons become the lock and retain their accessible names.

Edit, minimise, close, add/open, secondary, destructive, navigation and choice controls retain their original icons, colours and disabled styling. They receive no lock badges. No form validation, save, delete or data behavior changes are introduced by the shared styling.

Regression coverage checks native disabled state, one indicator per primary action, replacement of the old save arrow, compact confirmation names, fieldset disabling, Done without an explicit disabled prop, and absence of locks on ordinary controls in both enabled and disabled states. Browser verification checks the grey/closed-lock to green/open-lock transition in challenge creation without saving a challenge.
