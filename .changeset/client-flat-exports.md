---
"@thomasfosterau/effect-sveltekit": minor
---

The `./client` entry now also exports the members of its `Navigation`, `State`, `Remote`, `Realtime`, `Forms` and `Hooks` namespaces by name (#195): `goto`, `invalidate`, `invalidateAll`, `refreshAll`, `preloadData`, `preloadCode`, `beforeNavigate`, `afterNavigate`, `onNavigate` and `NavigationError`; `page`, `navigating`, `updated`, `checkForUpdate`, `CurrentPage` and `UpdateCheckError`; `callQuery`, `callCommand`, `callCommandWithUpdates`, `callPrerender`, `submitForm`, `submitFormWithUpdates` and `liveQueryStream`; `fromEventSource`, `fromWebSocket`, `EventSourceError` and `WebSocketError`; `enhance`, `applyAction`, `deserialize` and `ApplyActionError`; `handleError` and `init`; with the namespaces' types. The namespaces are unchanged.

Prefer the named imports in the browser bundle. The published build turns each namespace into a single object, so `Navigation.goto` also kept the navigation lifecycle members and their event registry, while `import { goto }` keeps only `Navigation.js`. `./server` and effect-svelte's `Store` keep their namespaces only.
