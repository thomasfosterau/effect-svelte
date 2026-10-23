---
"@thomasfosterau/effect-sveltekit": minor
---

The root entry now also exports the members of its `Hooks` and `Remote` namespaces by name: `reroute`, `transport`, `transporter`, `markerTransporter` and `responseHeadersTransporter` (with the `MarkerTransporterOptions` and `TransportEntry` types), and `callQuery`, `callCommand`, `callCommandWithUpdates`, `callPrerender`, `submitForm`, `submitFormWithUpdates` and `liveQueryStream` (with the `RemoteSubmit` type). The namespaces are unchanged.

Prefer the named imports in a universal `src/hooks.ts`. The published build turns each namespace into a single object, so `Hooks.transport({ ResponseHeaders: Hooks.responseHeadersTransporter })` also kept `Hooks.reroute` and the default universal runtime (with Effect's `HttpClient`, `Stream` and `ManagedRuntime`) in the client bundle. `import { transport, responseHeadersTransporter }` keeps only `response-headers.js` and `transport.js`. The README recipes now use the named imports.
