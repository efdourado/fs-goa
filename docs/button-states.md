# Button readiness

Buttons use `StateButton`, including the shared `Button` and creation actions. Native `disabled` remains the source of truth: disabled controls show a closed lock, an opaque neutral grey background and readable neutral text in both themes. Readiness actions show an open lock when available; primary actions use the usual green.

`StateFieldset` preserves native fieldset disabling and carries readiness to its descendant actions. This covers busy dialogs and locked settings, as well as controls with their own `disabled` prop. Small icon actions retain their accessible names; circular primary submit icons become the lock, while other icon controls get a small lock badge.

Secondary, destructive and choice controls retain their existing enabled styles and semantics. Navigation without a blocked state does not acquire a lock. No form validation, save, delete or data behavior changes are introduced by the shared styling.

Regression coverage checks native disabled state, one indicator per action, replacement of the old save arrow, compact action names, fieldset inheritance and choice semantics. Browser verification checks the grey/closed-lock to green/open-lock transition in challenge creation without saving a challenge.
