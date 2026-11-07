---
"@thomasfosterau/effect-sveltekit": patch
---

Remote functions pass a schema already converted with `Schema.toStandardSchemaV1` through untouched on effect 4.1, where that conversion returns a `Schema` and was being wrapped a second time.
