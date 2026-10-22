/**
 * Typed SvelteKit event stand-ins for the Node tests that call the wrappers
 * directly: a `ServerLoadEvent` for the server wrappers (`serverLoad`,
 * `action`, `endpoint`, ... — a `ServerLoadEvent` is also a `RequestEvent`),
 * and a client-style `LoadEvent` (no `request`) for universal `load`.
 */

import type { Cookies, LoadEvent, RequestEvent, ServerLoadEvent } from "@sveltejs/kit";

/** The OpenTelemetry span type SvelteKit puts on `event.tracing`. */
type Span = RequestEvent["tracing"]["root"];

// SAFETY: no wrapper in `src/` reads `event.cookies` until an effect calls a
// cookie method, and a test that calls one passes its own `cookies`.
const cookies = {} as Cookies;

// SAFETY: nothing in `src/` reads `event.tracing`, so the span's methods are
// never called.
const span = {} as Span;

/** Options for {@link mockEvent}. */
export interface MockEventOptions {
  /** The request URL (default `http://localhost/`). */
  readonly url?: string | undefined;
  /** The event's `locals` (default a fresh empty object). */
  readonly locals?: App.Locals | undefined;
  /** The event's `cookies` (default a stub whose methods must not be called). */
  readonly cookies?: Cookies | undefined;
  /** The event's `setHeaders` (default a no-op). */
  readonly setHeaders?: ((headers: Record<string, string>) => void) | undefined;
}

/**
 * Build a minimal `ServerLoadEvent` for `url`: a real `Request` and `URL`,
 * the global `fetch`, empty `params` and no route id. Never fails.
 */
export const mockEvent = (options: MockEventOptions = {}): ServerLoadEvent => {
  const url = options.url ?? "http://localhost/";
  return {
    request: new Request(url),
    fetch,
    cookies: options.cookies ?? cookies,
    getClientAddress: () => "127.0.0.1",
    locals: options.locals ?? {},
    params: {},
    platform: undefined,
    route: { id: null },
    setHeaders: options.setHeaders ?? (() => undefined),
    url: new URL(url),
    isDataRequest: false,
    isSubRequest: false,
    isRemoteRequest: false,
    tracing: { enabled: false, root: span, current: span },
    parent: () => Promise.resolve({}),
    depends: () => undefined,
    untrack: (fn) => fn(),
  };
};

/**
 * The `ServerLoadEvent` SvelteKit builds from a `RequestEvent` (as `resolve`
 * receives it) to call a server `load`: the same properties, `locals`
 * included, plus no-op `parent` / `depends` / `untrack`. Never fails.
 */
export const toServerLoadEvent = (event: RequestEvent): ServerLoadEvent => ({
  ...event,
  parent: () => Promise.resolve({}),
  depends: () => undefined,
  untrack: (fn) => fn(),
});

/**
 * Build a minimal client-style `LoadEvent` (no `request`, as in the browser)
 * for `http://localhost/`, with empty `data` and `params`. Never fails.
 */
export const mockLoadEvent = (): LoadEvent => ({
  url: new URL("http://localhost/"),
  params: {},
  route: { id: null },
  fetch,
  data: {},
  setHeaders: () => undefined,
  parent: () => Promise.resolve({}),
  depends: () => undefined,
  untrack: (fn) => fn(),
  tracing: { enabled: false, root: span, current: span },
});
