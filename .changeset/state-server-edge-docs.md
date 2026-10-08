---
"@thomasfosterau/effect-sveltekit": patch
---

`State`'s TSDoc now spells out the server-side edge cases: consuming a watched stream (`navigating`, `updated`, `CurrentPage.changes`) during server rendering hangs rather than failing, and `CurrentPage.get` dies with a defect on the server outside a render.
