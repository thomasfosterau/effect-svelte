/**
 * Effect-native services for the three per-request surfaces on a SvelteKit
 * `RequestEvent` — cookies, response headers, and locals — each as a tagged
 * `Context.Service` that can be `yield*`-ed in any handler effect and mocked
 * in tests with `Layer.succeed`.
 *
 * All three services are provided automatically as part of the
 * {@link SvelteKitServices} per-request context when using
 * {@link makeServerRuntime}, the standalone `serverLoad`/`action`/`endpoint`
 * wrappers, or {@link makeRuntimeAdapter}. No extra layer setup is required.
 *
 * @example
 * ```ts
 * import { Effect } from "effect";
 * import {
 *   SvelteKitCookies,
 *   SvelteKitResponseHeaders,
 *   SvelteKitLocals,
 * } from "@thomasfosterau/effect-sveltekit/server";
 *
 * export const load = serverLoad(() =>
 *   Effect.gen(function* () {
 *     const cookies = yield* SvelteKitCookies;
 *     const session = yield* cookies.get("session");
 *
 *     const headers = yield* SvelteKitResponseHeaders;
 *     yield* headers.set({ "cache-control": "max-age=60, s-maxage=300" });
 *
 *     const locals = yield* SvelteKitLocals;
 *     // locals is App.Locals — typed to your augmented interface
 *     const user = locals.user;
 *
 *     return { user };
 *   }),
 * );
 * ```
 *
 * ## Testing
 *
 * Because these are tagged services, they can be replaced with stubs via
 * `Layer.succeed` in unit tests without involving a real `RequestEvent`:
 *
 * ```ts
 * import { Layer } from "effect";
 * import { SvelteKitCookies } from "@thomasfosterau/effect-sveltekit/server";
 * import { runServerLoad, TestRequestEvent } from "@thomasfosterau/effect-sveltekit/testing";
 *
 * const MockCookies = Layer.succeed(SvelteKitCookies, {
 *   get: (name) => Effect.succeed(name === "session" ? "tok_test" : undefined),
 *   getAll: () => Effect.succeed([{ name: "session", value: "tok_test" }]),
 *   set: () => Effect.void,
 *   delete: () => Effect.void,
 *   serialize: (n, v) => Effect.succeed(`${n}=${v}`),
 * });
 *
 * const data = await runServerLoad(myLoadFn, TestRequestEvent(), { layer: MockCookies });
 * ```
 */

import type { Cookies, RequestEvent } from "@sveltejs/kit";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { SvelteKitRequestEvent } from "./runtime.js";

// ─── SvelteKitCookies ─────────────────────────────────────────────────────────

/**
 * The Effect-native interface exposed by {@link SvelteKitCookies}. Each method
 * mirrors the corresponding `Cookies` method from `@sveltejs/kit` but returns
 * an `Effect` rather than a raw value or `void`.
 */
export interface SvelteKitCookiesInterface {
  /** Get a cookie by name. Returns `undefined` when the cookie is absent. */
  readonly get: (...args: Parameters<Cookies["get"]>) => Effect.Effect<ReturnType<Cookies["get"]>>;
  /** Get all cookies as `{ name, value }` pairs. */
  readonly getAll: (
    ...args: Parameters<Cookies["getAll"]>
  ) => Effect.Effect<ReturnType<Cookies["getAll"]>>;
  /** Set a cookie (adds a `set-cookie` response header). */
  readonly set: (...args: Parameters<Cookies["set"]>) => Effect.Effect<void>;
  /** Delete a cookie by setting it to an empty value with a past expiry. */
  readonly delete: (...args: Parameters<Cookies["delete"]>) => Effect.Effect<void>;
  /** Serialize a cookie into a `Set-Cookie` string without adding it to the response. */
  readonly serialize: (
    ...args: Parameters<Cookies["serialize"]>
  ) => Effect.Effect<ReturnType<Cookies["serialize"]>>;
}

/**
 * An Effect service wrapping the `RequestEvent.cookies` API.
 *
 * Available automatically in every server handler effect (it is part of
 * {@link SvelteKitServices}). Use `yield* SvelteKitCookies` to obtain the
 * service; call its methods (each returns an `Effect`) to read or write
 * cookies.
 *
 * @example
 * ```ts
 * const session = yield* (yield* SvelteKitCookies).get("session");
 * ```
 */
export class SvelteKitCookies extends Context.Service<
  SvelteKitCookies,
  SvelteKitCookiesInterface
>()("@thomasfosterau/effect-sveltekit/SvelteKitCookies") {
  /**
   * Layer that builds the `SvelteKitCookies` service from the current
   * {@link SvelteKitRequestEvent}. Included in the per-request context
   * automatically; expose as a standalone layer for custom setups.
   */
  static readonly layer: Layer.Layer<SvelteKitCookies, never, SvelteKitRequestEvent> = Layer.effect(
    SvelteKitCookies,
    Effect.gen(function* () {
      const event = yield* SvelteKitRequestEvent;
      const { cookies } = event;
      return {
        get: (...args) => Effect.sync(() => cookies.get(...args)),
        getAll: (...args) => Effect.sync(() => cookies.getAll(...args)),
        set: (...args) => Effect.sync(() => cookies.set(...args)),
        delete: (...args) => Effect.sync(() => cookies.delete(...args)),
        serialize: (...args) => Effect.sync(() => cookies.serialize(...args)),
      };
    }),
  );
}

// ─── SvelteKitResponseHeaders ─────────────────────────────────────────────────

/**
 * The Effect-native interface exposed by {@link SvelteKitResponseHeaders}.
 */
export interface SvelteKitResponseHeadersInterface {
  /**
   * Set one or more response headers. Equivalent to `event.setHeaders(headers)`.
   *
   * Note: You cannot set `set-cookie` headers here — use
   * {@link SvelteKitCookies} instead.
   */
  readonly set: (headers: Record<string, string>) => Effect.Effect<void>;
}

/**
 * An Effect service wrapping the `RequestEvent.setHeaders` API.
 *
 * Available automatically in every server handler effect. Use
 * `yield* SvelteKitResponseHeaders` to obtain the service, then call
 * `headers.set(...)`.
 *
 * @example
 * ```ts
 * const headers = yield* SvelteKitResponseHeaders;
 * yield* headers.set({ "cache-control": "max-age=60, s-maxage=300" });
 * ```
 */
export class SvelteKitResponseHeaders extends Context.Service<
  SvelteKitResponseHeaders,
  SvelteKitResponseHeadersInterface
>()("@thomasfosterau/effect-sveltekit/SvelteKitResponseHeaders") {
  /**
   * Layer that builds the `SvelteKitResponseHeaders` service from the current
   * {@link SvelteKitRequestEvent}.
   */
  static readonly layer: Layer.Layer<SvelteKitResponseHeaders, never, SvelteKitRequestEvent> =
    Layer.effect(
      SvelteKitResponseHeaders,
      Effect.gen(function* () {
        const event = yield* SvelteKitRequestEvent;
        return { set: (headers) => Effect.sync(() => event.setHeaders(headers)) };
      }),
    );
}

// ─── SvelteKitLocals ──────────────────────────────────────────────────────────

/**
 * An Effect service that exposes the mutable `App.Locals` object for the
 * current request.
 *
 * `yield* SvelteKitLocals` returns the live `event.locals` reference — the
 * same object mutations in `hooks.server.ts` (e.g. setting `event.locals.user`
 * in a `handle` hook) write to. Mutations made to it inside handler effects
 * propagate back to subsequent hook middleware.
 *
 * Available automatically in every server handler effect.
 *
 * @example
 * ```ts
 * // Read a typed local (requires App.Locals augmentation in your app):
 * const { user } = yield* SvelteKitLocals;
 *
 * // Write a local (useful in handle hooks run via makeServerRuntime.handle):
 * const locals = yield* SvelteKitLocals;
 * locals.user = yield* Auth.currentUser;
 * ```
 */
export class SvelteKitLocals extends Context.Service<SvelteKitLocals, App.Locals>()(
  "@thomasfosterau/effect-sveltekit/SvelteKitLocals",
) {
  /**
   * Layer that exposes `event.locals` (the mutable `App.Locals` reference)
   * from the current {@link SvelteKitRequestEvent}.
   */
  static readonly layer: Layer.Layer<SvelteKitLocals, never, SvelteKitRequestEvent> = Layer.effect(
    SvelteKitLocals,
    Effect.gen(function* () {
      const event = yield* SvelteKitRequestEvent;
      return event.locals;
    }),
  );
}

// ─── Combined layer ───────────────────────────────────────────────────────────

/**
 * A convenience layer that provides all three request services
 * ({@link SvelteKitCookies}, {@link SvelteKitResponseHeaders},
 * {@link SvelteKitLocals}) from the current {@link SvelteKitRequestEvent}.
 *
 * This layer is merged into the per-request context automatically by
 * {@link makeServerRuntime}, the standalone wrappers, and
 * {@link makeRuntimeAdapter}. Expose it here for use in custom setups that
 * already have `SvelteKitRequestEvent` in scope.
 */
export const requestServicesLayer: Layer.Layer<
  SvelteKitCookies | SvelteKitResponseHeaders | SvelteKitLocals,
  never,
  SvelteKitRequestEvent
> = Layer.mergeAll(SvelteKitCookies.layer, SvelteKitResponseHeaders.layer, SvelteKitLocals.layer);

/** The three request services {@link requestServicesFrom} builds from an event. */
interface RequestServices {
  cookies: SvelteKitCookiesInterface;
  responseHeaders: SvelteKitResponseHeadersInterface;
  locals: App.Locals;
}

/**
 * Build all three request services directly from a {@link RequestEvent},
 * without going through {@link SvelteKitRequestEvent}. Used internally by
 * `requestLayer` in `app-runtime.ts` to avoid an extra indirection.
 */
export const requestServicesFrom = (event: RequestEvent): RequestServices => {
  const { cookies } = event;
  return {
    cookies: {
      get: (...args) => Effect.sync(() => cookies.get(...args)),
      getAll: (...args) => Effect.sync(() => cookies.getAll(...args)),
      set: (...args) => Effect.sync(() => cookies.set(...args)),
      delete: (...args) => Effect.sync(() => cookies.delete(...args)),
      serialize: (...args) => Effect.sync(() => cookies.serialize(...args)),
    },
    responseHeaders: { set: (headers) => Effect.sync(() => event.setHeaders(headers)) },
    locals: event.locals,
  };
};
