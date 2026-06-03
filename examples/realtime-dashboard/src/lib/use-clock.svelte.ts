import { Clock, Context, Effect, Schedule, Stream } from "effect";
import { getRuntime } from "@thomasfosterau/effect-svelte";

/**
 * A custom hook built on top of `getRuntime()` — the same primitive the
 * built-in hooks use.
 *
 * It reads the wall clock through Effect's `Clock` service once a second and
 * exposes it as reactive state. The runtime from context can be either a
 * plain services `Context` or a `ManagedRuntime`, so both cases are handled
 * when forking.
 */
export function useClock(): { readonly now: number } {
  const runtime = getRuntime();
  let now = $state(Date.now());

  $effect(() => {
    const tick = Stream.fromEffectRepeat(Clock.currentTimeMillis).pipe(
      Stream.schedule(Schedule.spaced("1 second")),
      Stream.runForEach((millis) =>
        Effect.sync(() => {
          now = millis;
        }),
      ),
    );

    // getRuntime() returns either a plain services Context or a
    // ManagedRuntime; dispatch to the matching fork API.
    const fiber = Context.isContext(runtime)
      ? Effect.runForkWith(runtime)(tick)
      : runtime.runFork(tick);

    return () => {
      fiber.interruptUnsafe(fiber.id);
    };
  });

  return {
    get now() {
      return now;
    },
  };
}
