---
"@thomasfosterau/effect-sveltekit": patch
---

Allow remote-function validators to accept schemas with optional fields.

`form` (and the validated `query`, `query.batch`, `query.live`, `command`, and
`prerender` helpers) no longer constrain a schema's encoded/input type to
`extend RemoteFormInput`. An optional Effect-Schema field encodes to
`T | undefined`, which is not assignable to `RemoteFormInput`'s index
signature, so the previous constraint rejected most real forms (e.g. an
optional `redirectTo` text input). The form helpers now accept any schema and
intersect its encoded/input type with `RemoteFormInput` in the produced
`RemoteForm`, so SvelteKit still sees a form-input-shaped input while optional
fields are allowed. The handler's `data` remains the precise decoded type.

This is type-only and backward compatible; runtime behaviour is unchanged.
