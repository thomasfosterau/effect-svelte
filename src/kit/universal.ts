import type { Load } from "@sveltejs/kit";
import { Effect } from "effect";
import type * as HttpClient from "@effect/platform/HttpClient";
import { makeUniversalRuntime, type UniversalRuntime } from "./app-runtime.js";

// Shared runtime (no application layer) backing the standalone `load` wrapper.
// Created lazily so importing this module has no side effects.
let defaultRuntime: UniversalRuntime | undefined;
const runtime = (): UniversalRuntime => (defaultRuntime ??= makeUniversalRuntime());

/**
 * Wraps an Effect-based function to work as a SvelteKit universal load function.
 *
 * The effect has access to `HttpClient` on both the server and the client:
 * it is backed by the load event's `fetch`, so relative URLs and SvelteKit's
 * fetch behaviours (deduplication, cookies forwarding) work as expected.
 *
 * To give effects access to your own application services, create an
 * app-wide runtime with `makeUniversalRuntime` and use its `load` instead.
 *
 * @example
 * ```ts
 * import { load as effectLoad } from '@thomasfosterau/effect-svelte/kit';
 * import * as HttpClient from '@effect/platform/HttpClient';
 * import { Effect } from 'effect';
 *
 * export const load = effectLoad((event) =>
 *   Effect.gen(function* () {
 *     const client = yield* HttpClient.HttpClient;
 *     const response = yield* client.get(`/api/items/${event.params.id}`);
 *     return { item: yield* response.json };
 *   })
 * );
 * ```
 */
export function load<
  Params extends Record<string, string> = any,
  InputData extends Record<string, unknown> | null = any,
  ParentData extends Record<string, unknown> = any,
  OutputData extends Record<string, unknown> | void = any,
  RouteId extends string | null = any,
>(
  fn: (
    event: Parameters<Load<Params, InputData, ParentData, OutputData, RouteId>>[0],
  ) => Effect.Effect<OutputData, unknown, HttpClient.HttpClient>,
): Load<Params, InputData, ParentData, OutputData, RouteId> {
  return runtime().load(fn);
}

/**
 * App-wide runtime: define your application's (universal) Effect services
 * once and share them across every `load` invocation.
 */
export { makeUniversalRuntime, type UniversalRuntime } from "./app-runtime.js";
