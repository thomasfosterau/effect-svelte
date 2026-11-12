/**
 * Runtime auto-wrappers used by the SvelteKit Vite plugin.
 *
 * The plugin replaces user-declared SvelteKit exports (`load`, `actions`,
 * `handle`, HTTP method handlers, etc.) with calls into the helpers in this
 * module. At runtime each helper detects whether the underlying value is an
 * Effect, a function returning an Effect, or a plain SvelteKit-compatible
 * function/value, and routes accordingly.
 *
 * When the plugin is configured with a `serverRuntime` / `clientRuntime`
 * module, that module's app-wide runtime (created with `makeServerRuntime` /
 * `makeUniversalRuntime`) is passed as the second argument to these helpers,
 * so plain-Effect exports get access to the application's services.
 *
 * The plugin wraps an export it found declared, but what the declaration holds
 * is only known at runtime, so every wrapper has two signatures: given an
 * Effect or a function it returns the SvelteKit export, and given `undefined`
 * (an export declared without a value) it returns `undefined`, leaving the
 * export absent.
 *
 * This module is internal — the public Vite plugin generates references to it.
 */

import type { Action, Actions, Load, RequestEvent, ServerLoad } from "@sveltejs/kit";
import type {
  Handle,
  HandleClientError,
  HandleFetch,
  HandleServerError,
  Reroute,
} from "@sveltejs/kit/hooks";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import { type ServerRuntime, type UniversalRuntime } from "../app-runtime.js";
import * as AppRuntime from "../app-runtime.js";
import { causeToThrowable } from "./error.js";
import { lazy } from "./lazy.js";
import { runPromiseExit } from "./run.js";

type AnyEffect = Effect.Effect<unknown, unknown>;

/**
 * An Effect a user function returns. Its requirements are open: whatever the
 * configured runtime does not provide surfaces as a missing-service defect
 * when it runs.
 */
type ReturnedEffect = Effect.Effect<unknown, unknown, unknown>;

/**
 * The function form of a user export: called with the hook / load argument, it
 * returns an Effect to run or `Plain`, what SvelteKit's own signature for that
 * export returns, to pass through. `Effect.isEffect` tells the two apart at
 * runtime.
 */
type UserFn<Arg, Plain> = (arg: Arg) => ReturnedEffect | Plain;

/** The argument-less function form of a user `init` export (see {@link UserFn}). */
type UserThunk = () => ReturnedEffect | void | Promise<void>;

type AnyRuntime = ServerRuntime<any, any> | UniversalRuntime<any, any>;

/**
 * Module shape accepted for the plugin's `serverRuntime` / `clientRuntime`
 * options: the runtime can be the default export or a named `runtime` export.
 */
export interface RuntimeModule {
  readonly runtime?: AnyRuntime;
  readonly default?: AnyRuntime;
}

// Default runtimes (no application layer), created lazily and shared across
// all requests in the process.
const defaultServerRuntime = lazy(() => AppRuntime.makeServerRuntime<any, any>());
const defaultUniversalRuntime = lazy(() => AppRuntime.makeUniversalRuntime<any, any>());

/** The runtime a runtime module exports; `None` without a module or an export. */
const runtimeOfModule = (mod?: RuntimeModule): Option.Option<AnyRuntime> =>
  Option.fromUndefinedOr(mod?.runtime ?? mod?.default);

/** Distinguish a ServerRuntime from a UniversalRuntime structurally. */
const isServerRuntime = (runtime: AnyRuntime): runtime is ServerRuntime<any, any> =>
  "serverLoad" in runtime;

/** The other half of {@link isServerRuntime}. */
const isUniversalRuntime = (runtime: AnyRuntime): runtime is UniversalRuntime<any, any> =>
  !isServerRuntime(runtime);

/** The server runtime for a module, falling back to the shared default. */
const serverRuntimeOf = (mod?: RuntimeModule): ServerRuntime<any, any> =>
  runtimeOfModule(mod).pipe(Option.filter(isServerRuntime), Option.getOrElse(defaultServerRuntime));

/** The universal runtime for a module, falling back to the shared default. */
const universalRuntimeOf = (mod?: RuntimeModule): UniversalRuntime<any, any> =>
  runtimeOfModule(mod).pipe(
    Option.filter(isUniversalRuntime),
    Option.getOrElse(defaultUniversalRuntime),
  );

/**
 * Run an effect without any request context (e.g. `init` hooks): on `runtime`,
 * or on Effect's default runtime when there is none.
 */
async function runBare<A, E>(
  effect: Effect.Effect<A, E>,
  runtime: Option.Option<AnyRuntime>,
): Promise<A> {
  const exit = await Option.match(runtime, {
    onNone: () => runPromiseExit(effect),
    onSome: (present) => present.runtime.runPromiseExit(effect),
  });

  return Exit.match(exit, {
    onFailure: (cause) => {
      throw causeToThrowable(cause);
    },
    onSuccess: (value) => value,
  });
}

/**
 * Detect an Effect returned by (or exported as) a user hook. Its requirements
 * are typed `never`: the user's export may only need what the runtime provides,
 * and anything else surfaces as a missing-service defect when it runs.
 */
const isUserEffect = (value: unknown): value is AnyEffect => Effect.isEffect(value);

/**
 * A user export the plugin wraps: an Effect, or a function of `Arg` returning
 * an Effect or `Plain`.
 */
type UserExport<Arg, Plain> = AnyEffect | UserFn<Arg, Plain>;

/** A user export's Effect form as is, or the result of calling its function form with `arg`. */
const resolveExport = <Arg, Plain>(value: UserExport<Arg, Plain>, arg: Arg) =>
  Effect.isEffect(value) ? value : value(arg);

/** A user export called with a load / request event (see {@link UserExport}). */
type LoadLikeInput<Plain> = UserExport<any, Plain>;

/** The page data a universal `load` resolves to. */
type LoadData = Awaited<ReturnType<Load>>;

/**
 * Wraps a value intended to be a SvelteKit universal `load` export.
 * Used by the Vite plugin for `+page.ts` / `+layout.ts`. An export that holds
 * `undefined` stays `undefined`.
 */
export function wrapLoad(value: LoadLikeInput<ReturnType<Load>>, runtimeMod?: RuntimeModule): Load;
export function wrapLoad(value: undefined, runtimeMod?: RuntimeModule): undefined;
export function wrapLoad(value?: LoadLikeInput<ReturnType<Load>>, runtimeMod?: RuntimeModule) {
  return Option.fromUndefinedOr(value).pipe(
    Option.map((present): Load => async (event) => {
      const result = resolveExport(present, event);
      // A non-Effect result is the user's own `load` return value, passed
      // through unchanged.
      if (!Effect.isEffect(result)) return result;

      // Reuse the universal runtime's load wrapper so client/server detection
      // and per-request services stay in one place.
      // SAFETY: the effect is the user's `load`; its value is the page data,
      // which SvelteKit itself validates when the load resolves.
      return universalRuntimeOf(runtimeMod).load(() => result as Effect.Effect<LoadData, unknown>)(
        event,
      );
    }),
    Option.getOrUndefined,
  );
}

/**
 * Shared implementation for server-side, event-based wrappers: an async
 * function of the request event that runs the export's Effect on the server
 * runtime, or passes the user's plain return value through.
 */
const serverEventHandler =
  <Plain>(value: LoadLikeInput<Plain>, runtimeMod?: RuntimeModule) =>
  async (event: RequestEvent): Promise<Awaited<Plain>> => {
    const result = resolveExport(value, event);
    if (!Effect.isEffect(result)) return await result;

    // SAFETY: the effect is the user's export; its value is what SvelteKit's
    // own signature for that export resolves to, which SvelteKit validates.
    return serverRuntimeOf(runtimeMod).runPromise(event, result) as Promise<Awaited<Plain>>;
  };

/**
 * Wraps a value intended to be a SvelteKit server `load` export.
 * Used by the Vite plugin for `+page.server.ts` / `+layout.server.ts`. An
 * export that holds `undefined` stays `undefined`.
 */
export function wrapServerLoad(
  value: LoadLikeInput<ReturnType<ServerLoad>>,
  runtimeMod?: RuntimeModule,
): ServerLoad;
export function wrapServerLoad(value: undefined, runtimeMod?: RuntimeModule): undefined;
export function wrapServerLoad(
  value?: LoadLikeInput<ReturnType<ServerLoad>>,
  runtimeMod?: RuntimeModule,
) {
  return Option.fromUndefinedOr(value).pipe(
    Option.map((present): ServerLoad => serverEventHandler(present, runtimeMod)),
    Option.getOrUndefined,
  );
}

/**
 * Wraps a single SvelteKit action handler. `undefined` stays `undefined`.
 */
export function wrapAction(
  value: LoadLikeInput<ReturnType<Action>>,
  runtimeMod?: RuntimeModule,
): Action;
export function wrapAction(value: undefined, runtimeMod?: RuntimeModule): undefined;
export function wrapAction(value?: LoadLikeInput<ReturnType<Action>>, runtimeMod?: RuntimeModule) {
  return Option.fromUndefinedOr(value).pipe(
    Option.map((present): Action => serverEventHandler(present, runtimeMod)),
    Option.getOrUndefined,
  );
}

/**
 * The `actions` object of a `+page.server.ts`, as the user wrote it: each
 * entry is an action export, and an entry may be missing.
 */
type UserActions = Readonly<Partial<Record<string, LoadLikeInput<ReturnType<Action>>>>>;

/**
 * Wraps a SvelteKit `actions` object, individually wrapping each entry. An
 * entry that holds `undefined` is dropped; an export that holds `undefined`
 * (or anything else that is not an object) is returned untouched.
 */
export function wrapActions(value: UserActions, runtimeMod?: RuntimeModule): Actions;
export function wrapActions(value: undefined, runtimeMod?: RuntimeModule): undefined;
export function wrapActions(value?: UserActions, runtimeMod?: RuntimeModule) {
  return Option.fromUndefinedOr(value).pipe(
    Option.map((actions): Actions => {
      if (!P.isObjectOrArray(actions)) return actions;
      return R.getSomes(
        R.map(actions, (action) =>
          Option.map(Option.fromUndefinedOr(action), (present) =>
            serverEventHandler(present, runtimeMod),
          ),
        ),
      );
    }),
    Option.getOrUndefined,
  );
}

type HandleInput = Parameters<Handle>[0];

/**
 * Wraps a SvelteKit `handle` hook export. An export that holds `undefined`
 * stays `undefined`.
 */
export function wrapHandle(
  value: UserExport<HandleInput, ReturnType<Handle>>,
  runtimeMod?: RuntimeModule,
): Handle;
export function wrapHandle(value: undefined, runtimeMod?: RuntimeModule): undefined;
export function wrapHandle(
  value?: UserExport<HandleInput, ReturnType<Handle>>,
  runtimeMod?: RuntimeModule,
) {
  return Option.fromUndefinedOr(value).pipe(
    Option.map((present): Handle => (input) => {
      const result = resolveExport(present, input);
      // A non-Effect result is the user's own `handle` return value (a
      // `Response` or a promise of one), passed through unchanged.
      if (!Effect.isEffect(result)) return result;

      // Route through `handle` so the per-request runtime is installed on
      // `event.locals` for the rest of the request, like the explicit wrapper.
      // SAFETY: the effect is the user's `handle`, which resolves to the
      // `Response`.
      return serverRuntimeOf(runtimeMod).handle(() => result as Effect.Effect<Response, unknown>)(
        input,
      );
    }),
    Option.getOrUndefined,
  );
}

type HandleFetchInput = Parameters<HandleFetch>[0];

/**
 * Wraps a SvelteKit `handleFetch` hook export. An export that holds
 * `undefined` stays `undefined`.
 */
export function wrapHandleFetch(
  value: UserExport<HandleFetchInput, ReturnType<HandleFetch>>,
  runtimeMod?: RuntimeModule,
): HandleFetch;
export function wrapHandleFetch(value: undefined, runtimeMod?: RuntimeModule): undefined;
export function wrapHandleFetch(
  value?: UserExport<HandleFetchInput, ReturnType<HandleFetch>>,
  runtimeMod?: RuntimeModule,
) {
  return Option.fromUndefinedOr(value).pipe(
    Option.map((present): HandleFetch => async (args) => {
      const result = resolveExport(present, args);
      // A non-Effect result is the user's own `handleFetch` return value (a
      // `Response` or a promise of one), passed through unchanged.
      if (!Effect.isEffect(result)) return result;

      // SAFETY: the effect is the user's `handleFetch`, which resolves to the
      // `Response`.
      return serverRuntimeOf(runtimeMod).runPromise(args.event, result) as Promise<Response>;
    }),
    Option.getOrUndefined,
  );
}

type AnyHandleError = HandleServerError | HandleClientError;
type HandleErrorInput = Parameters<AnyHandleError>[0];
type HandleErrorOutput = ReturnType<AnyHandleError>;

/**
 * Wraps a SvelteKit `handleError` hook export. An export that holds
 * `undefined` stays `undefined`.
 */
export function wrapHandleError(
  value: UserExport<HandleErrorInput, HandleErrorOutput>,
  runtimeMod?: RuntimeModule,
): AnyHandleError;
export function wrapHandleError(value: undefined, runtimeMod?: RuntimeModule): undefined;
export function wrapHandleError(
  value?: UserExport<HandleErrorInput, HandleErrorOutput>,
  runtimeMod?: RuntimeModule,
) {
  return Option.fromUndefinedOr(value).pipe(
    Option.map((present): AnyHandleError => async (args: HandleErrorInput) => {
      const result = resolveExport(present, args);
      if (!isUserEffect(result)) {
        // SAFETY: a non-Effect result is the user's own `handleError` return
        // value, passed through unchanged.
        return result as HandleErrorOutput;
      }

      // Server errors carry a RequestEvent; client errors carry a NavigationEvent.
      const event = args.event;
      if (event !== undefined && "request" in event) {
        // SAFETY: the effect is the user's `handleError`, which resolves to
        // its `App.Error` (or nothing).
        return serverRuntimeOf(runtimeMod).runPromise(event, result) as HandleErrorOutput;
      }

      // Client-side: run on the bare app runtime (no request services).
      // SAFETY: as above.
      return runBare(result, runtimeOfModule(runtimeMod)) as HandleErrorOutput;
    }),
    Option.getOrUndefined,
  );
}

/** What an HTTP endpoint export returns. */
type EndpointOutput = Response | Promise<Response>;

/** The endpoint handler the wrapper produces. */
type Endpoint = (event: RequestEvent) => EndpointOutput;

/**
 * Wraps a SvelteKit HTTP endpoint export (`GET`, `POST`, etc.).
 * Errors thrown by the underlying Effect propagate to SvelteKit's normal
 * error-handling pipeline (i.e. they are not silently swallowed). Use the
 * explicit `endpoint()` helper if you need the `exposeErrors` toggle. An
 * export that holds `undefined` stays `undefined`.
 */
export function wrapEndpoint(
  value: UserExport<RequestEvent, EndpointOutput>,
  runtimeMod?: RuntimeModule,
): Endpoint;
export function wrapEndpoint(value: undefined, runtimeMod?: RuntimeModule): undefined;
export function wrapEndpoint(
  value?: UserExport<RequestEvent, EndpointOutput>,
  runtimeMod?: RuntimeModule,
) {
  return Option.fromUndefinedOr(value).pipe(
    Option.map((present): Endpoint => serverEventHandler(present, runtimeMod)),
    Option.getOrUndefined,
  );
}

type RerouteEvent = Parameters<Reroute>[0];

/**
 * Wraps a SvelteKit universal `reroute` hook export. The effect runs on the
 * universal runtime with an `HttpClient` backed by the event's `fetch`, on both
 * the server and the client. An export that holds `undefined` stays
 * `undefined`.
 */
export function wrapReroute(
  value: UserExport<RerouteEvent, ReturnType<Reroute>>,
  runtimeMod?: RuntimeModule,
): Reroute;
export function wrapReroute(value: undefined, runtimeMod?: RuntimeModule): undefined;
export function wrapReroute(
  value?: UserExport<RerouteEvent, ReturnType<Reroute>>,
  runtimeMod?: RuntimeModule,
) {
  return Option.fromUndefinedOr(value).pipe(
    Option.map((present): Reroute => (event) => {
      const result = resolveExport(present, event);
      // A non-Effect result is the user's own `reroute` return value (a
      // pathname, a promise of one, or nothing), passed through unchanged.
      if (!Effect.isEffect(result)) return result;

      // SAFETY: the effect is the user's `reroute`, which resolves to the
      // pathname (or nothing).
      return universalRuntimeOf(runtimeMod).runPromise(event.fetch, result) as ReturnType<Reroute>;
    }),
    Option.getOrUndefined,
  );
}

/** The `init` hook the wrapper produces. */
type Init = () => Promise<void>;

/**
 * Wraps a SvelteKit `init` hook export (server or client).
 * `init` runs once at startup; there is no request event available, but the
 * application runtime's services (if configured) are. An export that holds
 * `undefined` stays `undefined`.
 */
export function wrapInit(value: AnyEffect | UserThunk, runtimeMod?: RuntimeModule): Init;
export function wrapInit(value: undefined, runtimeMod?: RuntimeModule): undefined;
export function wrapInit(value?: AnyEffect | UserThunk, runtimeMod?: RuntimeModule) {
  return Option.fromUndefinedOr(value).pipe(
    Option.map((present): Init => async () => {
      const result = Effect.isEffect(present) ? present : present();
      if (!isUserEffect(result)) {
        await result;
        return;
      }
      await runBare(result, runtimeOfModule(runtimeMod));
    }),
    Option.getOrUndefined,
  );
}
