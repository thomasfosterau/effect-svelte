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
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Result from "effect/Result";
import {
  makeServerRuntime,
  makeUniversalRuntime,
  type ServerRuntime,
  type UniversalRuntime,
} from "../app-runtime.js";
import { causeToThrowable } from "./error.js";

type AnyEffect = Effect.Effect<unknown, unknown, never>;

/**
 * The function form of a user export: called with the hook / load argument, it
 * returns an Effect to run or a plain SvelteKit value to pass through. Its
 * result is only known at runtime (`Effect.isEffect` tells the two apart).
 */
type UserFn<Arg> = (arg: Arg) => unknown;

/** The argument-less function form of a user `init` export (see {@link UserFn}). */
type UserThunk = () => unknown;

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
let defaultServerRuntime: ServerRuntime<any, any> | undefined;
let defaultUniversalRuntime: UniversalRuntime<any, any> | undefined;

/** Extract the runtime from a runtime module, if any. */
const runtimeOfModule = (mod?: RuntimeModule): AnyRuntime | undefined =>
  mod?.runtime ?? mod?.default;

/** Distinguish a ServerRuntime from a UniversalRuntime structurally. */
const isServerRuntime = (runtime: AnyRuntime): runtime is ServerRuntime<any, any> =>
  "serverLoad" in runtime;

/** The server runtime for a module, falling back to the shared default. */
const serverRuntimeOf = (mod?: RuntimeModule): ServerRuntime<any, any> => {
  const runtime = runtimeOfModule(mod);
  if (runtime !== undefined && isServerRuntime(runtime)) return runtime;
  return (defaultServerRuntime ??= makeServerRuntime<any, any>());
};

/** The universal runtime for a module, falling back to the shared default. */
const universalRuntimeOf = (mod?: RuntimeModule): UniversalRuntime<any, any> => {
  const runtime = runtimeOfModule(mod);
  if (runtime !== undefined && !isServerRuntime(runtime)) return runtime;
  return (defaultUniversalRuntime ??= makeUniversalRuntime<any, any>());
};

/** Run an effect without any request context (e.g. `init` hooks). */
async function runBare<A, E>(effect: Effect.Effect<A, E>, runtime?: AnyRuntime): Promise<A> {
  const exit = runtime
    ? await runtime.runtime.runPromiseExit(effect)
    : await Effect.runPromiseExit(effect);

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

/** A user export's Effect form as is, or the result of calling its function form with `arg`. */
const resolveExport = <Arg>(value: AnyEffect | UserFn<Arg>, arg: Arg) =>
  Effect.isEffect(value) ? value : value(arg);

type LoadLikeInput = undefined | AnyEffect | UserFn<any>;

/** The page data a universal `load` resolves to. */
type LoadData = Awaited<ReturnType<Load>>;

/**
 * Wraps a value intended to be a SvelteKit universal `load` export.
 * Used by the Vite plugin for `+page.ts` / `+layout.ts`.
 */
export function wrapLoad<T extends LoadLikeInput>(
  value: T,
  runtimeMod?: RuntimeModule,
): T extends undefined ? undefined : Load {
  if (value === undefined) {
    // SAFETY: `undefined` in, `undefined` out; anything else becomes a `Load`
    // (an async function of the load event), matching the conditional return.
    return undefined as never;
  }

  const load = async (event: Parameters<Load>[0]) => {
    const result = resolveExport(value, event);
    if (!Effect.isEffect(result)) return result;

    // Reuse the universal runtime's load wrapper so client/server detection
    // and per-request services stay in one place.
    // SAFETY: the effect is the user's `load`; its value is the page data,
    // which SvelteKit itself validates when the load resolves.
    return universalRuntimeOf(runtimeMod).load(
      () => result as Effect.Effect<LoadData, unknown, never>,
    )(event);
  };
  // SAFETY: see the `undefined` case above; a non-Effect result is the user's
  // own `load` return value, passed through unchanged.
  return load as never;
}

/** Shared implementation for server-side, event-based wrappers. */
function wrapServerEvent<T extends LoadLikeInput>(value: T, runtimeMod?: RuntimeModule) {
  if (value === undefined) return undefined;

  return async (event: RequestEvent) => {
    const result = resolveExport(value, event);
    if (!Effect.isEffect(result)) return result;

    return serverRuntimeOf(runtimeMod).runPromise(event, result);
  };
}

/**
 * Wraps a value intended to be a SvelteKit server `load` export.
 * Used by the Vite plugin for `+page.server.ts` / `+layout.server.ts`.
 */
export function wrapServerLoad<T extends LoadLikeInput>(
  value: T,
  runtimeMod?: RuntimeModule,
): T extends undefined ? undefined : ServerLoad {
  // SAFETY: `wrapServerEvent` returns `undefined` for `undefined` and otherwise
  // an async function of the request event that runs the effect or passes the
  // user's plain return value through — a `ServerLoad`.
  return wrapServerEvent(value, runtimeMod) as never;
}

/**
 * Wraps a single SvelteKit action handler.
 */
export function wrapAction<T extends LoadLikeInput>(
  value: T,
  runtimeMod?: RuntimeModule,
): T extends undefined ? undefined : Action {
  // SAFETY: `wrapServerEvent` returns `undefined` for `undefined` and otherwise
  // an async function of the request event that runs the effect or passes the
  // user's plain return value through — an `Action`.
  return wrapServerEvent(value, runtimeMod) as never;
}

/**
 * Wraps a SvelteKit `actions` object, individually wrapping each entry.
 */
export function wrapActions<T extends Record<string, LoadLikeInput> | undefined>(
  value: T,
  runtimeMod?: RuntimeModule,
): T extends undefined ? undefined : Actions {
  if (value === undefined || !Predicate.isObjectOrArray(value)) {
    // SAFETY: `undefined` and non-objects pass through untouched, as before;
    // an object becomes a record of wrapped actions (entries that are
    // `undefined` are dropped), which is an `Actions`.
    return value as never;
  }

  const wrapped = Rec.filterMap(value, (fn) => {
    const wrappedAction = wrapServerEvent(fn, runtimeMod);
    return wrappedAction === undefined ? Result.fail(undefined) : Result.succeed(wrappedAction);
  });
  // SAFETY: see above.
  return wrapped as never;
}

/**
 * Wraps a SvelteKit `handle` hook export.
 */
export function wrapHandle<T extends undefined | AnyEffect | UserFn<Parameters<Handle>[0]>>(
  value: T,
  runtimeMod?: RuntimeModule,
): T extends undefined ? undefined : Handle {
  if (value === undefined) {
    // SAFETY: `undefined` in, `undefined` out; anything else becomes the
    // `Handle` below, matching the conditional return.
    return undefined as never;
  }

  const handle: Handle = (input) => {
    const result = resolveExport(value, input);
    if (!Effect.isEffect(result)) {
      // SAFETY: a non-Effect result is the user's own `handle` return value
      // (a `Response` or a promise of one), passed through unchanged.
      return result as Response | Promise<Response>;
    }

    // Route through `handle` so the per-request runtime is installed on
    // `event.locals` for the rest of the request, like the explicit wrapper.
    // SAFETY: the effect is the user's `handle`, which resolves to the
    // `Response`; the runtime's `Handle` is async, so it returns a promise.
    return serverRuntimeOf(runtimeMod).handle(
      () => result as Effect.Effect<Response, unknown, never>,
    )(input) as Promise<Response>;
  };
  // SAFETY: see the `undefined` case above.
  return handle as never;
}

/**
 * Wraps a SvelteKit `handleFetch` hook export.
 */
export function wrapHandleFetch<
  T extends undefined | AnyEffect | UserFn<Parameters<HandleFetch>[0]>,
>(value: T, runtimeMod?: RuntimeModule): T extends undefined ? undefined : HandleFetch {
  if (value === undefined) {
    // SAFETY: `undefined` in, `undefined` out; anything else becomes the
    // `HandleFetch` below, matching the conditional return.
    return undefined as never;
  }

  const handleFetch: HandleFetch = async (args) => {
    const result = resolveExport(value, args);
    if (!Effect.isEffect(result)) {
      // SAFETY: a non-Effect result is the user's own `handleFetch` return value
      // (a `Response` or a promise of one), passed through unchanged.
      return result as Response | Promise<Response>;
    }

    // SAFETY: the effect is the user's `handleFetch`, which resolves to the
    // `Response`.
    return serverRuntimeOf(runtimeMod).runPromise(args.event, result) as Promise<Response>;
  };
  // SAFETY: see the `undefined` case above.
  return handleFetch as never;
}

type AnyHandleError = HandleServerError | HandleClientError;
type HandleErrorInput = Parameters<AnyHandleError>[0];
type HandleErrorOutput = ReturnType<AnyHandleError>;

/**
 * Wraps a SvelteKit `handleError` hook export.
 */
export function wrapHandleError<T extends undefined | AnyEffect | UserFn<HandleErrorInput>>(
  value: T,
  runtimeMod?: RuntimeModule,
): T extends undefined ? undefined : AnyHandleError {
  if (value === undefined) {
    // SAFETY: `undefined` in, `undefined` out; anything else becomes the
    // async `handleError` below, matching the conditional return.
    return undefined as never;
  }

  const handleError = async (args: HandleErrorInput) => {
    const result = resolveExport(value, args);
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
  };
  // SAFETY: see the `undefined` case above.
  return handleError as never;
}

/**
 * Wraps a SvelteKit HTTP endpoint export (`GET`, `POST`, etc.).
 * Errors thrown by the underlying Effect propagate to SvelteKit's normal
 * error-handling pipeline (i.e. they are not silently swallowed). Use the
 * explicit `endpoint()` helper if you need the `exposeErrors` toggle.
 */
export function wrapEndpoint<T extends undefined | AnyEffect | UserFn<RequestEvent>>(
  value: T,
  runtimeMod?: RuntimeModule,
): T extends undefined ? undefined : (event: RequestEvent) => Response | Promise<Response> {
  // SAFETY: `wrapServerEvent` returns `undefined` for `undefined` and otherwise
  // an async function of the request event that runs the effect or passes the
  // user's plain return value (a `Response`) through.
  return wrapServerEvent(value, runtimeMod) as never;
}

type RerouteEvent = Parameters<Reroute>[0];

/**
 * Wraps a SvelteKit universal `reroute` hook export. The effect runs on the
 * universal runtime with an `HttpClient` backed by the event's `fetch`, on both
 * the server and the client.
 */
export function wrapReroute<T extends undefined | AnyEffect | UserFn<RerouteEvent>>(
  value: T,
  runtimeMod?: RuntimeModule,
): T extends undefined ? undefined : Reroute {
  if (value === undefined) {
    // SAFETY: `undefined` in, `undefined` out; anything else becomes the
    // `reroute` below, matching the conditional return.
    return undefined as never;
  }

  const reroute = (event: RerouteEvent) => {
    const result = resolveExport(value, event);
    if (!Effect.isEffect(result)) {
      // SAFETY: a non-Effect result is the user's own `reroute` return value
      // (a pathname, a promise of one, or nothing), passed through unchanged.
      return result as ReturnType<Reroute>;
    }

    // SAFETY: the effect is the user's `reroute`, which resolves to the
    // pathname (or nothing).
    return universalRuntimeOf(runtimeMod).runPromise(event.fetch, result) as ReturnType<Reroute>;
  };
  // SAFETY: see the `undefined` case above.
  return reroute as never;
}

/**
 * Wraps a SvelteKit `init` hook export (server or client).
 * `init` runs once at startup; there is no request event available, but the
 * application runtime's services (if configured) are.
 */
export function wrapInit<T extends undefined | AnyEffect | UserThunk>(
  value: T,
  runtimeMod?: RuntimeModule,
): T extends undefined ? undefined : () => Promise<void> {
  if (value === undefined) {
    // SAFETY: `undefined` in, `undefined` out; anything else becomes the async
    // `init` below, matching the conditional return.
    return undefined as never;
  }

  const init = async () => {
    const result = Effect.isEffect(value) ? value : value();
    if (!isUserEffect(result)) {
      await result;
      return;
    }
    await runBare(result, runtimeOfModule(runtimeMod));
  };
  // SAFETY: see the `undefined` case above.
  return init as never;
}
