import { Layer, ManagedRuntime, Context, Effect } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type { RequestEvent } from "@sveltejs/kit";

/**
 * Service that provides access to the current SvelteKit RequestEvent.
 * This allows Effect code to access request-specific data like cookies, headers, etc.
 */
export class SvelteKitRequestEvent extends Context.Service<SvelteKitRequestEvent, RequestEvent>()(
  "SvelteKitRequestEvent",
) {}

/**
 * Custom runtime for SvelteKit server-side helpers.
 *
 * This runtime is designed for SvelteKit server-side execution and provides:
 * - HttpClient for making HTTP requests
 * - FetchHttpClient using the platform's fetch implementation
 * - SvelteKitRequestEvent for accessing SvelteKit-specific request data
 *
 * @example
 * ```ts
 * import { SvelteKitRuntime } from '@thomasfosterau/effect-svelte/kit/server';
 * import { Effect } from 'effect';
 * import * as HttpClient from 'effect/unstable/http/HttpClient';
 *
 * export const load = (event) => {
 *   const runtime = SvelteKitRuntime.forRequest(event);
 *   return runtime.runPromise(
 *     Effect.gen(function* () {
 *       // Access HttpClient from the runtime
 *       const client = yield* HttpClient.HttpClient;
 *       const response = yield* client.get("https://api.example.com/data");
 *       return { data: response };
 *     })
 *   );
 * };
 * ```
 */
export class SvelteKitRuntime {
  /**
   * Creates a layer with platform services for a specific request.
   * This includes FetchHttpClient and access to the RequestEvent.
   *
   * @param event - The SvelteKit RequestEvent
   * @returns A layer providing platform services
   */
  private static createRequestLayer(
    event: RequestEvent,
  ): Layer.Layer<HttpClient.HttpClient | SvelteKitRequestEvent> {
    // Provide HttpClient using SvelteKit's fetch
    const httpClientLayer = FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, event.fetch)),
    );

    // Provide access to the RequestEvent
    const requestEventLayer = Layer.succeed(SvelteKitRequestEvent, event);

    return Layer.merge(httpClientLayer, requestEventLayer);
  }

  /**
   * Creates a runtime for a specific SvelteKit request.
   * This runtime includes all platform services configured for the request.
   *
   * @param event - The SvelteKit RequestEvent
   * @returns A managed runtime with platform services
   */
  static forRequest(
    event: RequestEvent,
  ): ManagedRuntime.ManagedRuntime<HttpClient.HttpClient | SvelteKitRequestEvent, never> {
    return ManagedRuntime.make(this.createRequestLayer(event));
  }

  /**
   * Extends the request runtime with additional services.
   *
   * @param event - The SvelteKit RequestEvent
   * @param layer - Additional layer to merge
   * @returns A managed runtime with both platform and custom services
   *
   * @example
   * ```ts
   * import { SvelteKitRuntime } from '@thomasfosterau/effect-svelte/kit/server';
   * import { Layer, Context } from 'effect';
   *
   * class Database extends Context.Service<Database, {
   *   query: (sql: string) => Effect.Effect<unknown>
   * }>()("Database") {}
   *
   * const dbLayer = Layer.succeed(Database, {
   *   query: (sql) => Effect.succeed([])
   * });
   *
   * export const load = (event) => {
   *   const runtime = SvelteKitRuntime.extend(event, dbLayer);
   *   // Use runtime...
   * };
   * ```
   */
  static extend<R, E>(
    event: RequestEvent,
    layer: Layer.Layer<R, E>,
  ): ManagedRuntime.ManagedRuntime<R | HttpClient.HttpClient | SvelteKitRequestEvent, E> {
    return ManagedRuntime.make(Layer.merge(this.createRequestLayer(event), layer));
  }

  /**
   * Creates a runtime that provides `HttpClient` backed by the given fetch
   * implementation, without a `SvelteKitRequestEvent`.
   *
   * This is used for universal `load` functions running on the client, where
   * there is no `RequestEvent` but the load event still exposes `fetch`.
   *
   * @param fetchFn - The fetch implementation to back HttpClient with
   * @returns A managed runtime providing HttpClient
   */
  static forFetch(
    fetchFn: typeof globalThis.fetch,
  ): ManagedRuntime.ManagedRuntime<HttpClient.HttpClient, never> {
    return ManagedRuntime.make(
      FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn))),
    );
  }

  /**
   * The base layer for SvelteKit without request-specific services.
   * Use this for effects that don't need access to the request.
   */
  static readonly baseLayer = Layer.empty;

  /**
   * Creates a runtime from a custom layer.
   *
   * @param layer - The layer to use for the runtime
   * @returns A managed runtime
   */
  static make<R, E>(layer: Layer.Layer<R, E>): ManagedRuntime.ManagedRuntime<R, E> {
    return ManagedRuntime.make(layer);
  }
}

/**
 * Helper to run an effect with the SvelteKit runtime for a specific request.
 * This automatically sets up and tears down the runtime.
 *
 * @param event - The SvelteKit RequestEvent
 * @param effect - The effect to run
 * @returns A promise with the result
 *
 * @example
 * ```ts
 * import { runWithSvelteKitRuntime } from '@thomasfosterau/effect-svelte/kit/server';
 * import { Effect } from 'effect';
 *
 * export const load = async (event) => {
 *   return await runWithSvelteKitRuntime(event,
 *     Effect.succeed({ message: "Hello!" })
 *   );
 * };
 * ```
 */
export function runWithSvelteKitRuntime<A, E>(
  event: RequestEvent,
  effect: Effect.Effect<A, E, HttpClient.HttpClient | SvelteKitRequestEvent>,
): Promise<A> {
  const runtime = SvelteKitRuntime.forRequest(event);
  return runtime.runPromise(effect);
}
