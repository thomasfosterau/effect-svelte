/**
 * Client-only SvelteKit helpers for Effect integration.
 *
 * These run in the browser: Effect wrappers for `$app/navigation` and
 * `$app/state`, grouped into namespaces (`Navigation`, `State`, `Remote`),
 * the reactive `useRemoteQuery` hook, and the `Hooks` namespace wrapping the
 * client-side `hooks.client.ts` hooks (`handleError`, `init`).
 *
 * Every namespace member is also a plain named export. Prefer those in the
 * browser bundle: the published build turns each namespace into a single
 * object, so reaching one member through it keeps the namespace's every
 * member (and what they import), while a named import keeps only what it
 * uses (#195).
 */

// Effect wrappers for $app/navigation: promise-returning helpers (goto,
// invalidate, ...) and lifecycle events (beforeNavigate/afterNavigate/onNavigate).
export * as Navigation from "./Navigation.js";
export {
  NavigationError,
  goto,
  invalidate,
  invalidateAll,
  refreshAll,
  preloadData,
  preloadCode,
  beforeNavigate,
  afterNavigate,
  onNavigate,
} from "./Navigation.js";

// Effect bridge for $app/state: the current page as a Stream of snapshots.
export * as State from "./State.js";
export {
  UpdateCheckError,
  page,
  navigating,
  updated,
  checkForUpdate,
  CurrentPage,
  type CurrentPageInterface,
  type PageSnapshot,
  type NavigatingSnapshot,
} from "./State.js";

// Remote-function call helpers (callQuery, callCommand, liveQueryStream, ...).
export * as Remote from "./Remote.js";
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

// Reactive bridge: a remote query/resource as an AsyncResult.
export { useRemoteQuery, type RemoteQueryResult } from "./remote-reactive.js";

// Realtime bridges: an SSE endpoint or a WebSocket as an Effect Stream
// (counterpart to server-side `Endpoint.fromStream`).
export * as Realtime from "./realtime.js";
export {
  EventSourceError,
  fromEventSource,
  WebSocketError,
  fromWebSocket,
  type SseMessage,
  type EventSourceConstructor,
  type FromEventSourceOptions,
  type WebSocketConstructor,
  type FromWebSocketOptions,
} from "./realtime.js";

// Effect bridge for native form actions ($app/forms): an Effect-based
// `use:enhance` SubmitFunction, plus `applyAction` / `deserialize`.
export * as Forms from "./forms.js";
export {
  enhance,
  ApplyActionError,
  applyAction,
  deserialize,
  type EnhanceHandlers,
  type EnhanceOptions,
  type EnhanceOptionsArgs,
  type EnhanceRuntime,
  type SubmitInput,
  type ResultOptions,
} from "./forms.js";

// Effect wrappers for the client-side hooks (`hooks.client.ts`).
export * as Hooks from "./client/Hooks.js";
export { handleError, init } from "./client/Hooks.js";
