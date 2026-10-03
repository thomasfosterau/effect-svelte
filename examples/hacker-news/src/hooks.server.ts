import type { Handle } from "@sveltejs/kit/hooks";
import { Effect } from "effect";

/**
 * Server hook written as a function returning an Effect.
 *
 * The effectKit() Vite plugin rewrites this export so it runs through the
 * SvelteKit Effect runtime — no explicit wrapper needed.
 */
export const handle = ({ event, resolve }: Parameters<Handle>[0]) =>
  Effect.gen(function* () {
    const start = Date.now();
    const response = yield* Effect.promise(async () => resolve(event));
    yield* Effect.logInfo(
      `${event.request.method} ${event.url.pathname} -> ${response.status} (${Date.now() - start}ms)`,
    );
    return response;
  });
