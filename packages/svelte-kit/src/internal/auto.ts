/**
 * Runtime auto-wrappers used by the SvelteKit Vite plugin.
 *
 * The plugin replaces user-declared SvelteKit exports (`load`, `actions`,
 * `handle`, HTTP method handlers, etc.) with calls into the helpers in this
 * module. At runtime each helper detects whether the underlying value is an
 * Effect, a function returning an Effect, or a plain SvelteKit-compatible
 * function/value, and routes accordingly.
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
  ServerLoad,
} from "@sveltejs/kit";
import { Cause, Effect, Exit } from "effect";
import { SvelteKitRuntime } from "../runtime.js";

class EffectCauseError extends Error {
  declare cause: Cause.Cause<unknown>;

  constructor(message: string, cause: Cause.Cause<unknown>) {
    super(message);
    this.name = "EffectCauseError";
    this.cause = cause;
  }
}

function causeToError(cause: Cause.Cause<unknown>): Error {
  return new EffectCauseError(Cause.pretty(cause), cause);
}

type AnyEffect = Effect.Effect<unknown, unknown, never>;

async function runEffect(
  effect: AnyEffect,
  event: RequestEvent | undefined
): Promise<unknown> {
  const exit = event
    ? await SvelteKitRuntime.forRequest(event).runPromiseExit(effect)
    : await Effect.runPromiseExit(effect);

  return Exit.match(exit, {
    onFailure: (cause) => {
      throw causeToError(cause);
    },
    onSuccess: (value) => value,
  });
}

function isEffectValue(value: unknown): value is AnyEffect {
  return Effect.isEffect(value as never);
}

type LoadLikeInput =
  | undefined
  | AnyEffect
  | ((event: any) => unknown);

/**
 * Wraps a value intended to be a SvelteKit universal `load` export.
 * Used by the Vite plugin for `+page.ts` / `+layout.ts`.
 */
export function wrapLoad<T extends LoadLikeInput>(
  value: T
): T extends undefined ? undefined : Load {
  if (value === undefined) return undefined as never;

  return (async (event: Parameters<Load>[0]) => {
    if (isEffectValue(value)) {
      const eventForRuntime = (event as { request?: unknown }).request
        ? (event as unknown as RequestEvent)
        : undefined;
      return runEffect(value, eventForRuntime);
    }
    const result = (value as (event: unknown) => unknown)(event);
    if (isEffectValue(result)) {
      const eventForRuntime = (event as { request?: unknown }).request
        ? (event as unknown as RequestEvent)
        : undefined;
      return runEffect(result, eventForRuntime);
    }
    return result;
  }) as never;
}

/**
 * Wraps a value intended to be a SvelteKit server `load` export.
 * Used by the Vite plugin for `+page.server.ts` / `+layout.server.ts`.
 */
export function wrapServerLoad<T extends LoadLikeInput>(
  value: T
): T extends undefined ? undefined : ServerLoad {
  if (value === undefined) return undefined as never;

  return (async (event: RequestEvent) => {
    if (isEffectValue(value)) {
      return runEffect(value, event);
    }
    const result = (value as (event: RequestEvent) => unknown)(event);
    if (isEffectValue(result)) {
      return runEffect(result, event);
    }
    return result;
  }) as never;
}

/**
 * Wraps a single SvelteKit action handler.
 */
export function wrapAction<T extends LoadLikeInput>(
  value: T
): T extends undefined ? undefined : Action {
  if (value === undefined) return undefined as never;

  return (async (event: RequestEvent) => {
    if (isEffectValue(value)) {
      return runEffect(value, event);
    }
    const result = (value as (event: RequestEvent) => unknown)(event);
    if (isEffectValue(result)) {
      return runEffect(result, event);
    }
    return result;
  }) as never;
}

/**
 * Wraps a SvelteKit `actions` object, individually wrapping each entry.
 */
export function wrapActions<T extends Record<string, LoadLikeInput> | undefined>(
  value: T
): T extends undefined ? undefined : Actions {
  if (value === undefined) return undefined as never;
  if (typeof value !== "object" || value === null) return value as never;

  const wrapped: Actions = {};
  for (const [key, fn] of Object.entries(value)) {
    const wrappedAction = wrapAction(fn as LoadLikeInput);
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
  T extends
    | undefined
    | AnyEffect
    | ((args: Parameters<Handle>[0]) => unknown)
>(value: T): T extends undefined ? undefined : Handle {
  if (value === undefined) return undefined as never;

  const handle: Handle = async ({ event, resolve }) => {
    if (isEffectValue(value)) {
      return runEffect(value, event) as Promise<Response>;
    }
    const result = (value as (args: Parameters<Handle>[0]) => unknown)({
      event,
      resolve,
    });
    if (isEffectValue(result)) {
      return runEffect(result, event) as Promise<Response>;
    }
    return result as Response | Promise<Response>;
  };
  return handle as never;
}

/**
 * Wraps a SvelteKit `handleFetch` hook export.
 */
export function wrapHandleFetch<
  T extends
    | undefined
    | AnyEffect
    | ((args: Parameters<HandleFetch>[0]) => unknown)
>(value: T): T extends undefined ? undefined : HandleFetch {
  if (value === undefined) return undefined as never;

  const handleFetch: HandleFetch = async (args) => {
    if (isEffectValue(value)) {
      return runEffect(value, args.event) as Promise<Response>;
    }
    const result = (
      value as (args: Parameters<HandleFetch>[0]) => unknown
    )(args);
    if (isEffectValue(result)) {
      return runEffect(result, args.event) as Promise<Response>;
    }
    return result as Response | Promise<Response>;
  };
  return handleFetch as never;
}

type AnyHandleError = HandleServerError | HandleClientError;

/**
 * Wraps a SvelteKit `handleError` hook export.
 */
export function wrapHandleError<
  T extends
    | undefined
    | AnyEffect
    | ((args: Parameters<AnyHandleError>[0]) => unknown)
>(value: T): T extends undefined ? undefined : AnyHandleError {
  if (value === undefined) return undefined as never;

  return (async (args: Parameters<AnyHandleError>[0]) => {
    const maybeEvent = (args as { event?: RequestEvent }).event;
    if (isEffectValue(value)) {
      return runEffect(value, maybeEvent) as ReturnType<AnyHandleError>;
    }
    const result = (
      value as (args: Parameters<AnyHandleError>[0]) => unknown
    )(args);
    if (isEffectValue(result)) {
      return runEffect(result, maybeEvent) as ReturnType<AnyHandleError>;
    }
    return result as ReturnType<AnyHandleError>;
  }) as never;
}

type EndpointFn = (event: RequestEvent) => Response | Promise<Response>;

/**
 * Wraps a SvelteKit HTTP endpoint export (`GET`, `POST`, etc.).
 * Errors thrown by the underlying Effect propagate to SvelteKit's normal
 * error-handling pipeline (i.e. they are not silently swallowed). Use the
 * explicit `endpoint()` helper if you need the `exposeErrors` toggle.
 */
export function wrapEndpoint<
  T extends undefined | AnyEffect | ((event: RequestEvent) => unknown)
>(value: T): T extends undefined ? undefined : EndpointFn {
  if (value === undefined) return undefined as never;

  return (async (event: RequestEvent) => {
    if (isEffectValue(value)) {
      return runEffect(value, event) as Promise<Response>;
    }
    const result = (value as (event: RequestEvent) => unknown)(event);
    if (isEffectValue(result)) {
      return runEffect(result, event) as Promise<Response>;
    }
    return result as Response | Promise<Response>;
  }) as never;
}

/**
 * Wraps a SvelteKit `init` hook export (server or client).
 * `init` runs once at startup; there is no request event available.
 */
export function wrapInit<
  T extends undefined | AnyEffect | (() => unknown)
>(value: T): T extends undefined ? undefined : () => Promise<void> {
  if (value === undefined) return undefined as never;

  return (async () => {
    if (isEffectValue(value)) {
      await runEffect(value, undefined);
      return;
    }
    const result = (value as () => unknown)();
    if (isEffectValue(result)) {
      await runEffect(result, undefined);
      return;
    }
    await result;
  }) as never;
}
