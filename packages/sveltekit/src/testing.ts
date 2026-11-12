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

import type { Cookies, RequestEvent, ServerLoad } from "@sveltejs/kit";
import * as Effect from "effect/Effect";
import * as Arr from "effect/Array";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import {
  RequestRuntime,
  type ErrorTranslator,
  type RequestRuntimeProvider,
} from "./request-runtime.js";
import * as RequestRuntimeModule from "./request-runtime.js";
import { SvelteKit } from "./kit.js";
import * as RemoteRun from "./internal/remote-run.js";
import type { FormErrorMapper, RunHelpers } from "./internal/remote-run.js";

export type { RunHelpers, FormErrorMapper } from "./internal/remote-run.js";

// ─── TestCookies ─────────────────────────────────────────────────────────────

type CookieParseOptions = Parameters<Cookies["get"]>[1];
type CookieSerializeOptions = Parameters<Cookies["set"]>[2];

/** One stored cookie. */
interface TestCookie {
  readonly name: string;
  readonly value: string;
}

/**
 * In-memory Cookies implementation for use in {@link TestRequestEvent}: an
 * ordered list, so `getAll()` returns cookies in the order they were first set
 * (as SvelteKit's does), and `set` on an existing name replaces it in place.
 */
class TestCookies implements Cookies {
  private store: ReadonlyArray<TestCookie>;

  constructor(initial: Readonly<Record<string, string>> = {}) {
    this.store = Arr.map(R.toEntries(initial), ([name, value]) => ({ name, value }));
  }

  get(name: string, _opts?: CookieParseOptions): ReturnType<Cookies["get"]> {
    return Option.getOrUndefined(
      Option.map(
        Arr.findFirst(this.store, (cookie) => cookie.name === name),
        (cookie) => cookie.value,
      ),
    );
  }

  getAll(_opts?: CookieParseOptions): Array<{ name: string; value: string }> {
    return Arr.map(this.store, ({ name, value }) => ({ name, value }));
  }

  set(name: string, value: string, _opts?: CookieSerializeOptions): void {
    this.store = Option.match(
      Arr.findFirstIndex(this.store, (cookie) => cookie.name === name),
      {
        onNone: () => Arr.append(this.store, { name, value }),
        onSome: (index) =>
          Arr.map(this.store, (cookie, i) => (i === index ? { name, value } : cookie)),
      },
    );
  }

  delete(name: string, _opts?: CookieSerializeOptions): void {
    this.store = Arr.filter(this.store, (cookie) => cookie.name !== name);
  }

  serialize(name: string, value: string, _opts?: CookieSerializeOptions): string {
    return `${name}=${encodeURIComponent(value)}`;
  }

  /**
   * `cookies.parse` is the one member with no in-memory stand-in: it throws a
   * {@link TestCookiesParseError}.
   */
  parse(..._args: Parameters<Cookies["parse"]>): never {
    throw new TestCookiesParseError({
      message:
        "TestRequestEvent's cookies do not implement parse(): parse the Set-Cookie header in the test instead.",
    });
  }
}

/**
 * Thrown synchronously by `event.cookies.parse` of a {@link TestRequestEvent}:
 * its in-memory cookies have no `Set-Cookie` parser.
 */
export class TestCookiesParseError extends Schema.TaggedError<TestCookiesParseError>()(
  "TestCookiesParseError",
  { message: Schema.String },
) {}

/** A span's context when tracing is off, as SvelteKit's own no-op span reports it. */
const noopSpanContext = { traceId: "", spanId: "", traceFlags: 0 };

/**
 * The no-op span SvelteKit puts on `event.tracing` when tracing is disabled:
 * every method does nothing and returns the span.
 */
const noopSpan = {
  spanContext: () => noopSpanContext,
  setAttribute: () => noopSpan,
  setAttributes: () => noopSpan,
  addEvent: () => noopSpan,
  addLink: () => noopSpan,
  addLinks: () => noopSpan,
  setStatus: () => noopSpan,
  updateName: () => noopSpan,
  end: () => {},
  isRecording: () => false,
  recordException: () => {},
};

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
  /**
   * The request body, as `fetch`'s own `RequestInit["body"]`. Only usable with
   * methods that accept a body. Omit the key for a request without one.
   */
  readonly body?: RequestInit["body"];
  /**
   * Route params (e.g. `{ id: "123" }` for a route like `/items/[id]`).
   * Defaults to `{}`.
   */
  readonly params?: Record<string, string>;
  /**
   * Initial `event.locals` value, typed as your app's `App.Locals` (declare its
   * fields in `src/app.d.ts`). Defaults to `{}`.
   */
  readonly locals?: App.Locals;
  /**
   * Pre-seeded cookies as `{ name: value }` pairs.
   * The backing store supports `get`, `getAll`, `set`, `delete`, and
   * `serialize` (`parse` throws).
   */
  readonly cookies?: Record<string, string>;
  /**
   * The `event.platform` value, if any.
   * Pass a partial platform object matching the environment the handler targets.
   */
  readonly platform?: App.Platform;
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
 * Cookies are backed by an in-memory store; mutations (`set`, `delete`) are
 * reflected in subsequent `get`/`getAll` calls on the same event, and
 * `cookies.parse` throws a {@link TestCookiesParseError}. Tracing is off
 * (`event.tracing` holds no-op spans, as SvelteKit's does then) and
 * `isRemoteRequest` is `false`.
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
    params: opts.params ?? {},
    route: { id: null },
    fetch: fetchFn,
    cookies,
    locals: opts.locals ?? {},
    platform: opts.platform,
    isDataRequest: false,
    isSubRequest: false,
    setHeaders: () => {},
    getClientAddress: () => "127.0.0.1",
    isRemoteRequest: false,
    tracing: { enabled: false, root: noopSpan, current: noopSpan },
  };
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

/** An Effect-based handler under test, as the `run*` helpers take it. */
type TestHandler<A, R> = (event: RequestEvent) => Effect.Effect<A, unknown, R>;

/** {@link TestRunOptions} without a layer, for a handler that requires no services. */
type TestRunOptionsWithoutLayer = TestRunOptions<never> & { readonly layer?: never };

/** {@link TestRunOptions} with the layer that provides the handler's services `R`. */
type TestRunOptionsWithLayer<R> = TestRunOptions<R> & { readonly layer: Layer.Layer<R> };

/**
 * The two ways a `run*` helper is called, as its overloads spell them: with a
 * handler that requires no services, or with a handler and the layer that
 * provides the services `R` it requires.
 */
type TestRunArgs<A, R> =
  | readonly [fn: TestHandler<A, never>, event: RequestEvent, opts?: TestRunOptionsWithoutLayer]
  | readonly [fn: TestHandler<A, R>, event: RequestEvent, opts: TestRunOptionsWithLayer<R>];

/** Whether a `run*` helper was called with a layer. */
const hasLayer = <A, R>(
  args: TestRunArgs<A, R>,
): args is Extract<TestRunArgs<A, R>, readonly [unknown, unknown, TestRunOptionsWithLayer<R>]> =>
  args[2]?.layer !== undefined;

/** The adapter whose wrappers run a handler on `layer`. */
const adapterOn = <R>(layer: Layer.Layer<R>, opts?: Pick<TestRunOptions<R>, "translateError">) =>
  RequestRuntimeModule.makeRuntimeAdapter(RequestRuntime.fromLayer(layer), {
    translateError: opts?.translateError ?? SvelteKit.translate,
  });

/** A server `load`'s event for `event`: no parent data, and nothing tracked. */
const serverLoadEvent = (event: RequestEvent): Parameters<ServerLoad>[0] => ({
  ...event,
  parent: () => Promise.resolve({}),
  depends: () => {},
  untrack: (fn) => fn(),
});

/** Runs `fn` as the adapter's server `load` for `event`. */
const loadOn = <A extends Record<string, any> | void, R>(
  adapter: RequestRuntimeModule.RuntimeAdapter<R>,
  fn: TestHandler<A, R>,
  event: RequestEvent,
): Promise<A> =>
  // The handler gets the caller's own event; the copy with a `load`'s extra
  // members is what the wrapper reads the route id from.
  Promise.resolve(adapter.serverLoad(() => fn(event))(serverLoadEvent(event)));

/** Runs `fn` as the adapter's form action for `event`. */
const actOn = <A extends Record<string, any> | void, R>(
  adapter: RequestRuntimeModule.RuntimeAdapter<R>,
  fn: TestHandler<A, R>,
  event: RequestEvent,
): Promise<A> => Promise.resolve(adapter.action(fn)(event));

/** Runs `fn` as the adapter's endpoint for `event`. */
const respondOn = <R>(
  adapter: RequestRuntimeModule.RuntimeAdapter<R>,
  fn: TestHandler<Response, R>,
  event: RequestEvent,
): Promise<Response> => Promise.resolve(adapter.endpoint(fn)(event));

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
export function runServerLoad<R, A extends Record<string, any> | void = void>(
  fn: (event: RequestEvent) => Effect.Effect<A, unknown, R>,
  event: RequestEvent,
  opts: TestRunOptions<R> & { readonly layer: Layer.Layer<R> },
): Promise<A>;
/**
 * Run an Effect-based server `load` function that requires no services under
 * test, with no layer. Errors are translated by `opts.translateError`.
 */
export function runServerLoad<A extends Record<string, any> | void = void>(
  fn: (event: RequestEvent) => Effect.Effect<A, unknown>,
  event: RequestEvent,
  opts: TestRunOptions<never> & { readonly layer?: never },
): Promise<A>;
/**
 * Run an Effect-based server `load` function that requires no services under
 * test, with no layer. Errors are translated by {@link SvelteKit.translate}.
 */
export function runServerLoad<A extends Record<string, any> | void = void>(
  fn: (event: RequestEvent) => Effect.Effect<A, unknown>,
  event: RequestEvent,
): Promise<A>;
export function runServerLoad<R, A extends Record<string, any> | void>(
  ...args: TestRunArgs<A, R>
): Promise<A> {
  return hasLayer(args)
    ? loadOn(adapterOn(args[2].layer, args[2]), args[0], args[1])
    : loadOn(adapterOn(Layer.empty, args[2]), args[0], args[1]);
}

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
export function runAction<R, A extends Record<string, any> | void = void>(
  fn: (event: RequestEvent) => Effect.Effect<A, unknown, R>,
  event: RequestEvent,
  opts: TestRunOptions<R> & { readonly layer: Layer.Layer<R> },
): Promise<A>;
/**
 * Run an Effect-based form action handler that requires no services under
 * test, with no layer. Errors are translated by `opts.translateError`.
 */
export function runAction<A extends Record<string, any> | void = void>(
  fn: (event: RequestEvent) => Effect.Effect<A, unknown>,
  event: RequestEvent,
  opts: TestRunOptions<never> & { readonly layer?: never },
): Promise<A>;
/**
 * Run an Effect-based form action handler that requires no services under
 * test, with no layer. Errors are translated by {@link SvelteKit.translate}.
 */
export function runAction<A extends Record<string, any> | void = void>(
  fn: (event: RequestEvent) => Effect.Effect<A, unknown>,
  event: RequestEvent,
): Promise<A>;
export function runAction<R, A extends Record<string, any> | void>(
  ...args: TestRunArgs<A, R>
): Promise<A> {
  return hasLayer(args)
    ? actOn(adapterOn(args[2].layer, args[2]), args[0], args[1])
    : actOn(adapterOn(Layer.empty, args[2]), args[0], args[1]);
}

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
export function runEndpoint<R>(
  fn: (event: RequestEvent) => Effect.Effect<Response, unknown, R>,
  event: RequestEvent,
  opts: TestRunOptions<R> & { readonly layer: Layer.Layer<R> },
): Promise<Response>;
/**
 * Run an Effect-based `+server.ts` endpoint handler that requires no services
 * under test, with no layer. A failure `opts.translateError` does not turn
 * into SvelteKit control flow becomes a 500 `Response`.
 */
export function runEndpoint(
  fn: (event: RequestEvent) => Effect.Effect<Response, unknown>,
  event: RequestEvent,
  opts: TestRunOptions<never> & { readonly layer?: never },
): Promise<Response>;
/**
 * Run an Effect-based `+server.ts` endpoint handler that requires no services
 * under test, with no layer. A failure that is not SvelteKit control flow
 * becomes a 500 `Response`.
 */
export function runEndpoint(
  fn: (event: RequestEvent) => Effect.Effect<Response, unknown>,
  event: RequestEvent,
): Promise<Response>;
export function runEndpoint<R>(...args: TestRunArgs<Response, R>): Promise<Response> {
  return hasLayer(args)
    ? respondOn(adapterOn(args[2].layer, args[2]), args[0], args[1])
    : respondOn(adapterOn(Layer.empty, args[2]), args[0], args[1]);
}

/** The remote-function helpers that run a handler for `event` on `provider`. */
const remoteHelpersOn = <R>(
  event: RequestEvent,
  provider: RequestRuntimeProvider<R>,
  opts?: Pick<RunRemoteOptions<R>, "translateError" | "formError">,
): RunHelpers<R> =>
  RemoteRun.makeRunHelpers(
    () => ({ runExit: (effect) => provider.run(event).runPromiseExit(effect) }),
    opts?.translateError ?? SvelteKit.translate,
    opts?.formError,
  );

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
export function runRemote<R>(
  event: RequestEvent,
  opts: RunRemoteOptions<R> & { readonly layer: Layer.Layer<R> },
): RunHelpers<R>;
/**
 * Build a `{ run, runForm }` helper pair for remote-function Effect handlers
 * that require no services, with no layer.
 */
export function runRemote(
  event: RequestEvent,
  opts?: RunRemoteOptions<never> & { readonly layer?: never },
): RunHelpers;
export function runRemote<R>(
  event: RequestEvent,
  opts?: RunRemoteOptions<R>,
): RunHelpers<R> | RunHelpers {
  // Without a layer the handlers run on an empty one.
  return opts?.layer === undefined
    ? remoteHelpersOn(event, RequestRuntime.fromLayer(Layer.empty), opts)
    : remoteHelpersOn(event, RequestRuntime.fromLayer(opts.layer), opts);
}
