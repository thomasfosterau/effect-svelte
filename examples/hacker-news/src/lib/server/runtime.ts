import { Layer } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { makeServerRuntime } from "@thomasfosterau/effect-sveltekit/server";
import { HackerNews } from "$lib/hn/service";
import { Bookmarks } from "$lib/server/bookmarks";

/**
 * The app-wide Effect runtime: every server-side service the app needs,
 * defined once and shared across all requests.
 *
 * - Routes using the explicit wrappers import `runtime` and use
 *   `runtime.serverLoad` / `runtime.actions` / `runtime.endpoint`.
 * - Routes that export bare Effects get this runtime through the
 *   `effectKit({ serverRuntime: "$lib/server/runtime" })` Vite plugin option.
 *
 * The layer is built lazily on the first request and reused for the lifetime
 * of the server process. Because it is built outside of any request, services
 * here cannot use the per-request `SvelteKitRequestEvent` / `HttpClient`;
 * `HackerNews` brings its own `FetchHttpClient` instead.
 */
export const runtime = makeServerRuntime(
  Layer.mergeAll(HackerNews.layer, Bookmarks.layer).pipe(Layer.provide(FetchHttpClient.layer)),
);
