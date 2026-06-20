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

import type {
  Action,
  Actions,
  Handle,
  HandleClientError,
  HandleFetch,
  HandleServerError,
  Load,
  RequestEvent,
  Reroute,
  ServerLoad,
} from "@sveltejs/kit";
import { Effect, Exit } from "effect";
import {
  makeServerRuntime,
  makeUniversalRuntime,
  type ServerRuntime,
  type UniversalRuntime,
} from "../app-runtime.js";
import { causeToThrowable } from "./error.js";

type AnyEffect = Effect.Effect<unknown, unknown, never>;

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
async function runBare(effect: AnyEffect, runtime?: AnyRuntime): Promise<unknown> {
  const exit = runtime
    ? ((await runtime.runtime.runPromiseExit(effect)) as Exit.Exit<unknown, unknown>)
    : await Effect.runPromiseExit(effect);

  return Exit.match(exit, {
    onFailure: (cause) => {
      throw causeToThrowable(cause);
    },
    onSuccess: (value) => value,
  });
}

function isEffectValue(value: unknown): value is AnyEffect {
  return Effect.isEffect(value as never);
}

type LoadLikeInput = undefined | AnyEffect | ((event: any) => unknown);

/**
 * Wraps a value intended to be a SvelteKit universal `load` export.
 * Used by the Vite plugin for `+page.ts` / `+layout.ts`.
 */
export function wrapLoad<T extends LoadLikeInput>(
  value: T,
  runtimeMod?: RuntimeModule,
): T extends undefined ? undefined : Load {
  if (value === undefined) return undefined as never;

  return (async (event: Parameters<Load>[0]) => {
    const result = isEffectValue(value) ? value : (value as (event: unknown) => unknown)(event);
    if (!isEffectValue(result)) return result;

    // Reuse the universal runtime's load wrapper so client/server detection
    // and per-request services stay in one place.
    return universalRuntimeOf(runtimeMod).load(
      () => result as Effect.Effect<Record<string, unknown>, unknown, never>,
    )(event);
  }) as never;
}

/** Shared implementation for server-side, event-based wrappers. */
function wrapServerEvent<T extends LoadLikeInput>(
  value: T,
  runtimeMod?: RuntimeModule,
): undefined | ((event: RequestEvent) => Promise<unknown>) {
  if (value === undefined) return undefined;

  return async (event: RequestEvent) => {
    const result = isEffectValue(value)
      ? value
      : (value as (event: RequestEvent) => unknown)(event);
    if (!isEffectValue(result)) return result;

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
  return wrapServerEvent(value, runtimeMod) as never;
}

/**
 * Wraps a single SvelteKit action handler.
 */
export function wrapAction<T extends LoadLikeInput>(
  value: T,
  runtimeMod?: RuntimeModule,
): T extends undefined ? undefined : Action {
  return wrapServerEvent(value, runtimeMod) as never;
}

/**
 * Wraps a SvelteKit `actions` object, individually wrapping each entry.
 */
export function wrapActions<T extends Record<string, LoadLikeInput> | undefined>(
  value: T,
  runtimeMod?: RuntimeModule,
): T extends undefined ? undefined : Actions {
  if (value === undefined) return undefined as never;
  if (typeof value !== "object" || value === null) return value as never;

  const wrapped: Actions = {};
  for (const [key, fn] of Object.entries(value)) {
    const wrappedAction = wrapAction(fn as LoadLikeInput, runtimeMod);
    if (wrappedAction !== undefined) {
      wrapped[key] = wrappedAction;
    }
  }
  return wrapped as never;
}

/**
 * Wraps a SvelteKit `handle` hook export.
 */
export function wrapHandle<
  T extends undefined | AnyEffect | ((args: Parameters<Handle>[0]) => unknown),
>(value: T, runtimeMod?: RuntimeModule): T extends undefined ? undefined : Handle {
  if (value === undefined) return undefined as never;

  const handle: Handle = (input) => {
    const result = isEffectValue(value)
      ? value
      : (value as (args: Parameters<Handle>[0]) => unknown)(input);
    if (!isEffectValue(result)) return result as Response | Promise<Response>;

    // Route through `handle` so the per-request runtime is installed on
    // `event.locals` for the rest of the request, like the explicit wrapper.
    return serverRuntimeOf(runtimeMod).handle(
      () => result as Effect.Effect<Response, unknown, never>,
    )(input) as Promise<Response>;
  };
  return handle as never;
}

/**
 * Wraps a SvelteKit `handleFetch` hook export.
 */
export function wrapHandleFetch<
  T extends undefined | AnyEffect | ((args: Parameters<HandleFetch>[0]) => unknown),
>(value: T, runtimeMod?: RuntimeModule): T extends undefined ? undefined : HandleFetch {
  if (value === undefined) return undefined as never;

  const handleFetch: HandleFetch = async (args) => {
    const result = isEffectValue(value)
      ? value
      : (value as (args: Parameters<HandleFetch>[0]) => unknown)(args);
    if (!isEffectValue(result)) return result as Response | Promise<Response>;

    return serverRuntimeOf(runtimeMod).runPromise(args.event, result) as Promise<Response>;
  };
  return handleFetch as never;
}

type AnyHandleError = HandleServerError | HandleClientError;

/**
 * Wraps a SvelteKit `handleError` hook export.
 */
export function wrapHandleError<
  T extends undefined | AnyEffect | ((args: Parameters<AnyHandleError>[0]) => unknown),
>(value: T, runtimeMod?: RuntimeModule): T extends undefined ? undefined : AnyHandleError {
  if (value === undefined) return undefined as never;

  return (async (args: Parameters<AnyHandleError>[0]) => {
    const result = isEffectValue(value)
      ? value
      : (value as (args: Parameters<AnyHandleError>[0]) => unknown)(args);
    if (!isEffectValue(result)) return result as ReturnType<AnyHandleError>;

    // Server errors carry a RequestEvent; client errors carry a NavigationEvent.
    const event = (args as { event?: RequestEvent }).event;
    const isServerEvent = event !== undefined && "request" in event;

    if (isServerEvent) {
      return serverRuntimeOf(runtimeMod).runPromise(event, result) as ReturnType<AnyHandleError>;
    }

    // Client-side: run on the bare app runtime (no request services).
    return runBare(result, runtimeOfModule(runtimeMod)) as ReturnType<AnyHandleError>;
  }) as never;
}

/**
 * Wraps a SvelteKit HTTP endpoint export (`GET`, `POST`, etc.).
 * Errors thrown by the underlying Effect propagate to SvelteKit's normal
 * error-handling pipeline (i.e. they are not silently swallowed). Use the
 * explicit `endpoint()` helper if you need the `exposeErrors` toggle.
 */
export function wrapEndpoint<T extends undefined | AnyEffect | ((event: RequestEvent) => unknown)>(
  value: T,
  runtimeMod?: RuntimeModule,
): T extends undefined ? undefined : (event: RequestEvent) => Response | Promise<Response> {
  return wrapServerEvent(value as LoadLikeInput, runtimeMod) as never;
}

type RerouteEvent = Parameters<Reroute>[0];

/**
 * Wraps a SvelteKit universal `reroute` hook export. The effect runs on the
 * universal runtime with an `HttpClient` backed by the event's `fetch`, on both
 * the server and the client.
 */
export function wrapReroute<T extends undefined | AnyEffect | ((event: RerouteEvent) => unknown)>(
  value: T,
  runtimeMod?: RuntimeModule,
): T extends undefined ? undefined : Reroute {
  if (value === undefined) return undefined as never;

  return ((event: RerouteEvent) => {
    const result = isEffectValue(value)
      ? value
      : (value as (event: RerouteEvent) => unknown)(event);
    if (!isEffectValue(result)) return result as ReturnType<Reroute>;

    return universalRuntimeOf(runtimeMod).runPromise(event.fetch, result) as ReturnType<Reroute>;
  }) as never;
}

/**
 * Wraps a SvelteKit `init` hook export (server or client).
 * `init` runs once at startup; there is no request event available, but the
 * application runtime's services (if configured) are.
 */
export function wrapInit<T extends undefined | AnyEffect | (() => unknown)>(
  value: T,
  runtimeMod?: RuntimeModule,
): T extends undefined ? undefined : () => Promise<void> {
  if (value === undefined) return undefined as never;

  return (async () => {
    const result = isEffectValue(value) ? value : (value as () => unknown)();
    if (!isEffectValue(result)) {
      await result;
      return;
    }
    await runBare(result, runtimeOfModule(runtimeMod));
  }) as never;
}
