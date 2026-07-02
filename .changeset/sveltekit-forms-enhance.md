---
"@thomasfosterau/effect-sveltekit": minor
---

Add a `Forms` bridge for native form actions (`@thomasfosterau/effect-sveltekit/client`): `Forms.enhance({ onSubmit, onResult })` builds an Effect-based `use:enhance` `SubmitFunction`, and `Forms.applyAction` / `Forms.deserialize` wrap `$app/forms`. Also adds a cookbook covering the typed `HttpApiClient` ↔ `Endpoint.fromApi` loop and build-time-vs-runtime `$env` config guidance (#51).
