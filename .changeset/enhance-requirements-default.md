---
"@thomasfosterau/effect-sveltekit": patch
---

`Forms.enhance`'s inferred requirements parameters (`RSubmit`, `RResult`, `RError`) now show their default as `unknown` in hovers and `.d.ts` rather than through an internal alias for it. Nothing changes for callers.
