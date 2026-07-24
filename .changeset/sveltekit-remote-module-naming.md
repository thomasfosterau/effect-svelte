---
"@thomasfosterau/effect-sveltekit": patch
---

Fix SvelteKit v3 remote-functions validation rejecting the built package.

SvelteKit `3.0.0-next.11` broadened its remote-module matcher from
`endsWith(".remote" + ext)` to the regex `/[/.]remote(\.[^/]+)+$/`
(`@sveltejs/kit` `src/exports/vite/utils.js`). That regex matches
`dist/remote.server.js`, so kit began treating this package's internal
remote-function **factory** module as a consumer remote module and validated,
at build/import time, that every export is a remote function — failing every
production build during the postbuild `analyse` phase with:

```
`RemoteFunction` exported from .../dist/remote.server.js is invalid —
all exports from this file must be remote functions
```

The module exports factories/types (`RemoteFunction`, `withRuntime`, `query`,
`form`, …), not remote functions, so it must never carry a name kit classifies
as a remote module. It is renamed `remote.server.ts` → `remote-functions.ts`
(built to `dist/remote-functions.js`), which no longer matches the matcher. The
public API is unchanged: `RemoteFunction` is still exported from
`@thomasfosterau/effect-sveltekit/server`, and no package export subpath
changes. A regression test guards against any published module being named such
that kit would treat it as a remote module.
