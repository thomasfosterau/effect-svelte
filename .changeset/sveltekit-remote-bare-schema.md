---
"@thomasfosterau/effect-sveltekit": patch
---

`RemoteFunction.*` (`query` / `query.batch` / `query.live` / `form` / `command`
/ `prerender`) now accept a bare Effect `Schema` as the validator argument: it is
detected and wrapped with `Schema.toStandardSchemaV1` automatically, so you no
longer have to pre-wrap it. Passing a Standard Schema or `"unchecked"` is
unchanged.
