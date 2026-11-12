/**
 * Typed SvelteKit event stand-ins for the Node tests that call the wrappers
 * directly: a `ServerLoadEvent` for the server wrappers (`serverLoad`,
 * `action`, `endpoint`, ... — a `ServerLoadEvent` is also a `RequestEvent`),
 * and a client-style `LoadEvent` (no `request`) for universal `load`.
 */

import type { Cookies, LoadEvent, RequestEvent, ServerLoadEvent } from "@sveltejs/kit";
import { TestRequestEvent } from "../../src/testing.js";

/** Options for {@link mockEvent}. */
export interface MockEventOptions {
  /** The request URL (default `http://localhost/`). */
  readonly url?: string;
  /** The event's `locals` (default a fresh empty object). */
  readonly locals?: App.Locals;
  /** The event's `cookies` (default an empty in-memory store). */
  readonly cookies?: Cookies;
  /** The event's `setHeaders` (default a no-op). */
  readonly setHeaders?: RequestEvent["setHeaders"];
}

/**
 * Build a minimal `ServerLoadEvent` for `url`: a real `Request` and `URL`,
 * the global `fetch`, empty `params` and no route id. Never fails.
 */
export const mockEvent = (options: MockEventOptions = {}): ServerLoadEvent => {
  // The package's own test event supplies the members no test here sets: the
  // in-memory cookies and the no-op tracing spans among them.
  const event = TestRequestEvent({ url: options.url ?? "http://localhost/" });
  return {
    ...event,
    cookies: options.cookies ?? event.cookies,
    locals: options.locals ?? {},
    setHeaders: options.setHeaders ?? event.setHeaders,
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
  tracing: TestRequestEvent().tracing,
});
