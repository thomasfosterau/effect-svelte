/**
 * Universal SvelteKit helpers for Effect integration.
 * These helpers work on both client and server.
 *
 * For server-only helpers, import from '@thomasfosterau/effect-sveltekit/server'
 * For client-only helpers, import from '@thomasfosterau/effect-sveltekit/client'
 */

// Re-export universal helpers
export * from "./universal.js";
export * as Remote from "./Remote.js";

/**
 * The `Remote` namespace's members as plain named exports. Prefer these in
 * client code: the published build turns `Remote` into a single object, so
 * reaching a member through it keeps every member in the bundle, while a named
 * import keeps only what it uses (#191).
 */
export {
  callQuery,
  callCommand,
  callCommandWithUpdates,
  callPrerender,
  submitForm,
  submitFormWithUpdates,
  liveQueryStream,
  type RemoteSubmit,
} from "./Remote.js";
export type { SvelteKitServices } from "./app-runtime.js";

// Effect wrappers for the universal hooks (`hooks.ts`): the `Hooks` namespace
// exposes `reroute` and the Effect Schema ⇄ `transport` helpers.
export * as Hooks from "./Hooks.js";

/**
 * The universal `Hooks` namespace's members as plain named exports. Prefer
 * these in a universal `src/hooks.ts`, which runs on every page: the published
 * build turns `Hooks` into a single object, so `Hooks.transport` also keeps
 * `Hooks.reroute` and the default universal runtime behind it in the client
 * bundle, while `import { transport } from "@thomasfosterau/effect-sveltekit"`
 * keeps only the transport helpers (#188, #191).
 */
export {
  reroute,
  transport,
  transporter,
  markerTransporter,
  responseHeadersTransporter,
  type MarkerTransporterOptions,
  type TransportEntry,
} from "./Hooks.js";

// A response-headers buffer that can be returned from `load` (see `Hooks.responseHeadersTransporter`).
export { ResponseHeaders } from "./response-headers.js";

// SvelteKit `$env` ⇄ Effect `Config`
export { sveltekitConfig, sveltekitConfigProvider, readConfig } from "./config.js";

// Typed HttpApiClient for an `Endpoint.fromApi`, with FetchHttpClient provided.
export { apiClient, type ApiClientOptions } from "./api-client.js";
