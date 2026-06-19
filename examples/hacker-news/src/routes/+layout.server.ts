import { Effect } from "effect";
import { runWithSvelteKitRuntime } from "@thomasfosterau/effect-sveltekit/server";
import type { LayoutServerLoadEvent } from "./$types";

/**
 * Demonstrates the lowest-level API: running an Effect against the SvelteKit
 * runtime manually, without any wrapper or plugin involvement.
 *
 * Because this load returns a Promise (not an Effect), the effectKit() Vite
 * plugin passes it through untouched — and SvelteKit's generated $types work
 * as usual.
 */
export const load = (event: LayoutServerLoadEvent) =>
  runWithSvelteKitRuntime(
    event,
    Effect.gen(function* () {
      yield* Effect.logDebug(`layout load for ${event.url.pathname}`);
      return { generatedAt: Date.now() };
    }),
  );
