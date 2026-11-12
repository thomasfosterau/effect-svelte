---
"@thomasfosterau/effect-sveltekit": minor
---

New `optionTransporter` (also `Hooks.optionTransporter`): the `transport` entry for any `Option`, registered once as `transport({ Option: optionTransporter })`. It encodes the structure only (`Some(value)` as `[value]`, `None` as `[]`) and leaves the value to SvelteKit's serialiser, so a `Some` may hold a `Date`, a `Map`, a `Set`, a `BigInt`, a `URL`, `undefined`, `null`, another `Option` or any other registered transport type.

Use it in place of a JSON-codec entry such as `Schema.toCodecJson(Schema.Option(Schema.Unknown))`, which throws while the page is being serialised (a 500 at run time, with no type error) when a `Some` holds a value that is not JSON.
