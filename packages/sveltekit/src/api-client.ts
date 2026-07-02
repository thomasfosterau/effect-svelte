/**
 * A typed client for an Effect [`HttpApi`](https://effect.website) served by
 * {@link Endpoint.fromApi}, closing the serve↔consume loop.
 *
 * {@link apiClient} wraps Effect's own `HttpApiClient.make` and provides the
 * `HttpClient` for you (via `FetchHttpClient`), so a browser or a universal
 * `load` can call the same-origin API with full end-to-end types derived from
 * the shared `HttpApi` definition. In a `load`, pass `event.fetch` so the call
 * participates in SvelteKit's SSR fetch (relative URLs, credentials, dedupe).
 *
 * @example
 * ```ts
 * // src/routes/+page.ts — a universal load
 * import { apiClient } from "@thomasfosterau/effect-sveltekit";
 * import { Effect } from "effect";
 * import { api } from "$lib/api"; // the shared HttpApi definition
 *
 * export const load = (event) =>
 *   Effect.gen(function* () {
 *     const client = yield* apiClient(api, { baseUrl: "/api", fetch: event.fetch });
 *     return { user: yield* client.users.get({ path: { id: event.params.id } }) };
 *   });
 * ```
 */

import { Effect, Layer } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";
import type * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";

/** Options for {@link apiClient}. */
export interface ApiClientOptions {
  /**
   * The base URL the API is mounted at. For an `Endpoint.fromApi` mounted at
   * `src/routes/api/[...path]` with `prefix: "/api"`, pass `"/api"`. Defaults to
   * the endpoint paths relative to the current origin.
   */
  readonly baseUrl?: URL | string;
  /**
   * The `fetch` implementation to use. In a `load`, pass `event.fetch` so the
   * request joins SvelteKit's SSR fetch. Defaults to the platform `fetch`.
   */
  readonly fetch?: typeof globalThis.fetch;
  /** Transform the underlying `HttpClient` (e.g. add headers, retries). */
  readonly transformClient?: (client: HttpClient.HttpClient) => HttpClient.HttpClient;
}

/**
 * Build a typed {@link HttpApiClient} for `api`, with the `HttpClient` provided
 * via `FetchHttpClient`. Yields the client from an `Effect`; the only remaining
 * requirement is any client middleware the API declares.
 */
export const apiClient = <ApiId extends string, Groups extends HttpApiGroup.Any>(
  api: HttpApi.HttpApi<ApiId, Groups>,
  options?: ApiClientOptions,
): Effect.Effect<HttpApiClient.Client<Groups>, never, HttpApiGroup.MiddlewareClient<Groups>> => {
  const fetchLayer =
    options?.fetch === undefined
      ? FetchHttpClient.layer
      : FetchHttpClient.layer.pipe(
          Layer.provide(Layer.succeed(FetchHttpClient.Fetch, options.fetch)),
        );

  return HttpApiClient.make(api, {
    baseUrl: options?.baseUrl,
    transformClient: options?.transformClient,
  }).pipe(Effect.provide(fetchLayer));
};
