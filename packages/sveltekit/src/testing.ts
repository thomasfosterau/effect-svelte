/**
 * Framework-agnostic test utilities for `@thomasfosterau/effect-sveltekit`.
 *
 * Exports a minimal {@link TestRequestEvent} constructor and plain-async
 * runner helpers ({@link runServerLoad}, {@link runAction},
 * {@link runEndpoint}, {@link runRemote}) so Effect-based SvelteKit handlers
 * can be unit-tested without mocking the SvelteKit module graph or installing
 * `$app/server`.
 *
 * Ships under the `./testing` subpath of `@thomasfosterau/effect-sveltekit`.
 * It has no coupling to Vitest, Jest, or any other test framework — import
 * it from whichever test runner you use.
 *
 * @example
 * ```ts
 * import {
 *   TestRequestEvent,
 *   runServerLoad,
 *   runAction,
 *   runRemote,
 * } from "@thomasfosterau/effect-sveltekit/testing";
 * import { Effect } from "effect";
 *
 * const event = TestRequestEvent({ params: { id: "1" }, locals: { user } });
 *
 * // Test a server load:
 * const data = await runServerLoad(
 *   (event) =>
 *     Effect.gen(function* () {
 *       const db = yield* Database;
 *       return { item: yield* db.findById(event.params.id) };
 *     }),
 *   event,
 *   { layer: TestDatabase.layer },
 * );
 *
 * // Test a remote function handler directly:
 * const { run } = runRemote(event, { layer: TestLayer });
 * const items = await run(listItems());
 * ```
 */

import type { RequestEvent } from "@sveltejs/kit";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  makeRuntimeAdapter,
  RequestRuntime,
  type ErrorTranslator,
  type RequestRuntimeProvider,
} from "./request-runtime.js";
import { SvelteKit } from "./kit.js";
import { makeRunHelpers, type FormErrorMapper, type RunHelpers } from "./internal/remote-run.js";

export type { RunHelpers, FormErrorMapper } from "./internal/remote-run.js";

// ─── TestCookies ─────────────────────────────────────────────────────────────

/** Map-backed Cookies implementation for use in {@link TestRequestEvent}. */
class TestCookies {
  private readonly store: Map<string, string>;

  constructor(initial: Record<string, string> = {}) {
    this.store = new Map(Object.entries(initial));
  }

  get(name: string, _opts?: unknown): string | undefined {
    return this.store.get(name);
  }

  getAll(_opts?: unknown): Array<{ name: string; value: string }> {
    return [...this.store.entries()].map(([name, value]) => ({ name, value }));
  }

  set(name: string, value: string, _opts?: unknown): void {
    this.store.set(name, value);
  }

  delete(name: string, _opts?: unknown): void {
    this.store.delete(name);
  }

  serialize(name: string, value: string, _opts?: unknown): string {
    return `${name}=${encodeURIComponent(value)}`;
  }
}

// ─── TestRequestEvent ─────────────────────────────────────────────────────────

/** Options for {@link TestRequestEvent}. */
export interface TestRequestEventOptions {
  /**
   * The request URL. Accepts a `string` or a `URL` instance.
   * Defaults to `"http://localhost/"`.
   */
  readonly url?: string | URL;
  /** The HTTP method. Defaults to `"GET"`. */
  readonly method?: string;
  /** Additional HTTP headers added to the underlying `Request`. */
  readonly headers?: HeadersInit;
  /** The request body. Only usable with methods that accept a body. */
  readonly body?: BodyInit | null;
  /**
   * Route params (e.g. `{ id: "123" }` for a route like `/items/[id]`).
   * Defaults to `{}`.
   */
  readonly params?: Record<string, string>;
  /**
   * Initial `event.locals` value. Defaults to `{}`.
   * Cast to `App.Locals` — extend it with the properties your handlers need.
   */
  readonly locals?: Record<string, unknown>;
  /**
   * Pre-seeded cookies as `{ name: value }` pairs.
   * The backing store supports `get`, `getAll`, `set`, `delete`, and
   * `serialize`; the object is cast to SvelteKit's `Cookies` interface.
   */
  readonly cookies?: Record<string, string>;
  /**
   * The `event.platform` value, if any.
   * Pass a partial platform object matching the environment the handler targets.
   */
  readonly platform?: unknown;
  /**
   * The `fetch` implementation used by `event.fetch`.
   * Defaults to `globalThis.fetch`. Pass a custom function to intercept or
   * stub network calls made by the handler.
   */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Create a minimal {@link RequestEvent} for use in unit tests.
 *
 * All fields are optional — omit what the handler under test doesn't inspect.
 * Cookies are backed by an in-memory `Map`; mutations (`set`, `delete`) are
 * reflected in subsequent `get`/`getAll` calls on the same event.
 *
 * @example
 * ```ts
 * const event = TestRequestEvent({
 *   url: "http://localhost/items/42",
 *   params: { id: "42" },
 *   locals: { user: { id: "u1", role: "admin" } },
 *   cookies: { session: "tok_test" },
 * });
 * ```
 */
export function TestRequestEvent(opts: TestRequestEventOptions = {}): RequestEvent {
  const rawUrl = opts.url instanceof URL ? opts.url.toString() : (opts.url ?? "http://localhost/");
  const url = new URL(rawUrl);

  const init: RequestInit = { method: opts.method ?? "GET" };
  if (opts.headers !== undefined) init.headers = opts.headers;
  if (opts.body !== undefined) init.body = opts.body;

  const request = new Request(url.toString(), init);
  const cookies = new TestCookies(opts.cookies ?? {});
  const fetchFn = opts.fetch ?? globalThis.fetch;

  return {
    request,
    url,
    params: (opts.params ?? {}) as any,
    route: { id: null },
    fetch: fetchFn,
    cookies: cookies as any,
    locals: (opts.locals ?? {}) as any,
    platform: opts.platform as any,
    isDataRequest: false,
    isSubRequest: false,
    setHeaders: () => {},
    getClientAddress: () => "127.0.0.1",
  } as unknown as RequestEvent;
}

// ─── Options ──────────────────────────────────────────────────────────────────

/**
 * Options shared by {@link runServerLoad}, {@link runAction}, and
 * {@link runEndpoint}.
 */
export interface TestRunOptions<R> {
  /**
   * The `Layer` providing the handler effect's required services `R`.
   * Omit when the handler has no service requirements (`R` is `never`).
   */
  readonly layer?: Layer.Layer<R>;
  /**
   * Translate a failed `Cause` at the boundary. Defaults to
   * {@link SvelteKit.translate} (Kit control-flow through; anything else
   * becomes an `EffectCauseError`).
   */
  readonly translateError?: ErrorTranslator;
}

/**
 * Options for {@link runRemote}.
 */
export interface RunRemoteOptions<R> {
  /** The `Layer` providing the remote handler's service requirements. */
  readonly layer?: Layer.Layer<R>;
  /**
   * Translate a failed `Cause` at the boundary. Defaults to
   * {@link SvelteKit.translate}.
   */
  readonly translateError?: ErrorTranslator;
  /**
   * Map a remote form handler's failure to SvelteKit field issues. Receives
   * the squashed handler failure and the `{ issue, data }` context. When
   * provided it is called instead of `translateError` on the form error path.
   */
  readonly formError?: FormErrorMapper;
}

// ─── Internal ─────────────────────────────────────────────────────────────────

const makeAdapter = <R>(opts: TestRunOptions<R> | undefined) =>
  makeRuntimeAdapter(RequestRuntime.fromLayer((opts?.layer ?? Layer.empty) as Layer.Layer<R>), {
    translateError: opts?.translateError ?? SvelteKit.translate,
  });

// ─── runServerLoad ────────────────────────────────────────────────────────────

/**
 * Run an Effect-based server `load` function under test.
 *
 * Wraps `fn` with `makeRuntimeAdapter` using the provided `opts.layer` (or
 * `Layer.empty` when omitted) and calls the resulting `ServerLoad` with
 * `event`. Errors are translated by `opts.translateError` (defaults to
 * {@link SvelteKit.translate}).
 *
 * @example
 * ```ts
 * const data = await runServerLoad(
 *   (event) => Effect.gen(function* () {
 *     const db = yield* Database;
 *     return { items: yield* db.list() };
 *   }),
 *   TestRequestEvent(),
 *   { layer: TestDatabase.layer },
 * );
 * expect(data.items).toHaveLength(0);
 * ```
 */
export const runServerLoad = <R, A extends Record<string, any> | void = void>(
  fn: (event: RequestEvent) => Effect.Effect<A, unknown, R>,
  event: RequestEvent,
  opts?: TestRunOptions<R>,
): Promise<A> => (makeAdapter(opts).serverLoad(fn) as (e: RequestEvent) => Promise<A>)(event);

// ─── runAction ───────────────────────────────────────────────────────────────

/**
 * Run an Effect-based form action handler under test.
 *
 * @example
 * ```ts
 * const result = await runAction(
 *   (_event) => Effect.succeed({ success: true }),
 *   TestRequestEvent({ method: "POST" }),
 * );
 * expect((result as any).success).toBe(true);
 * ```
 */
export const runAction = <R, A extends Record<string, any> | void = void>(
  fn: (event: RequestEvent) => Effect.Effect<A, unknown, R>,
  event: RequestEvent,
  opts?: TestRunOptions<R>,
): Promise<A> => (makeAdapter(opts).action(fn) as (e: RequestEvent) => Promise<A>)(event);

// ─── runEndpoint ──────────────────────────────────────────────────────────────

/**
 * Run an Effect-based `+server.ts` endpoint handler under test.
 *
 * @example
 * ```ts
 * const response = await runEndpoint(
 *   (_event) => Effect.succeed(new Response(JSON.stringify({ ok: true }))),
 *   TestRequestEvent({ url: "http://localhost/api/ping" }),
 * );
 * expect(response.status).toBe(200);
 * ```
 */
export const runEndpoint = <R>(
  fn: (event: RequestEvent) => Effect.Effect<Response, unknown, R>,
  event: RequestEvent,
  opts?: TestRunOptions<R>,
): Promise<Response> => Promise.resolve(makeAdapter(opts).endpoint(fn)(event as any));

// ─── runRemote ────────────────────────────────────────────────────────────────

/**
 * Build a `{ run, runForm }` helper pair for directly invoking remote-function
 * Effect handlers under test.
 *
 * Unlike the production `query` / `command` / `form` helpers, which resolve the
 * request event via `$app/server.getRequestEvent()`, this resolves it from the
 * `event` argument you supply — no SvelteKit module-graph mocking required.
 *
 * Use `run` for `query` / `command` handlers and `runForm` for `form` handlers
 * that need the `issue` / `data` context.
 *
 * @example
 * ```ts
 * import { TestRequestEvent, runRemote } from "@thomasfosterau/effect-sveltekit/testing";
 *
 * const event = TestRequestEvent();
 * const { run } = runRemote(event, { layer: TestDatabase.layer });
 *
 * // Invoke the underlying Effect directly — no AppServer needed:
 * const items = await run(listItemsEffect());
 * expect(items).toEqual([]);
 * ```
 */
export const runRemote = <R = never>(
  event: RequestEvent,
  opts?: RunRemoteOptions<R>,
): RunHelpers => {
  const translate = opts?.translateError ?? SvelteKit.translate;
  const layer = (opts?.layer ?? Layer.empty) as Layer.Layer<R>;
  const provider: RequestRuntimeProvider<R> = RequestRuntime.fromLayer(layer);
  return makeRunHelpers(
    () => ({ runExit: (effect) => provider.run(event).runPromiseExit(effect) }),
    translate,
    opts?.formError,
  );
};
