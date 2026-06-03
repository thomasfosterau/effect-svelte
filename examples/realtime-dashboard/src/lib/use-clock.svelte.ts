import { Clock, Effect, ManagedRuntime, Runtime, Schedule, Stream } from "effect";
import { getRuntime } from "@thomasfosterau/effect-svelte";

/**
 * A custom hook built on top of `getRuntime()` — the same primitive the
 * built-in hooks use.
 *
 * It reads the wall clock through Effect's `Clock` service once a second and
 * exposes it as reactive state. The runtime from context can be either a
 * plain `Runtime` or a `ManagedRuntime`, so both cases are handled when
 * forking.
 */
export function useClock(): { readonly now: number } {
  const runtime = getRuntime();
  let now = $state(Date.now());

  $effect(() => {
    const tick = Stream.repeatEffect(Clock.currentTimeMillis).pipe(
      Stream.schedule(Schedule.spaced("1 second")),
      Stream.runForEach((millis) =>
        Effect.sync(() => {
          now = millis;
        }),
      ),
    );

    // getRuntime() returns either a ManagedRuntime or a plain Runtime;
    // dispatch to the matching fork API. (The isManagedRuntime guard does
    // not narrow the union's other arm, hence the cast.)
    const fiber = ManagedRuntime.isManagedRuntime(runtime)
      ? runtime.runFork(tick)
      : Runtime.runFork(runtime as Runtime.Runtime<never>)(tick);

    return () => {
      fiber.unsafeInterruptAsFork(fiber.id());
    };
  });

  return {
    get now() {
      return now;
    },
  };
}
