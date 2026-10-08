---
"@thomasfosterau/effect-sveltekit": minor
---

`State` (in `./client`) now bridges all of `$app/state`, not just `page`. `State.navigating()` streams the in-flight navigation as an `Option<NavigatingSnapshot>` (`None` when idle), `State.updated()` streams `updated.current`, and `State.checkForUpdate()` runs `updated.check()` as an Effect that fails with the new `UpdateCheckError` if the check rejects. `State.CurrentPage` is a `Context` service that lets any client Effect read the current page (`get`) or follow it (`changes`, which also emits on shallow routing and form results); provide it with `State.CurrentPage.layer`. These watch `$app/state` through a root `$effect`, so unlike `State.page()` they can be called anywhere on the client, not only during component initialization. `PageSnapshot` (and so every `State.page()` emission) now also carries SvelteKit 3's `shallow` field.
