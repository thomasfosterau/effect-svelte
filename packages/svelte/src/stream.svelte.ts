import type { Stream } from "effect";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import { getRuntime } from "./context.svelte.js";
import type { RuntimeLike } from "./internal/run.js";
import { streamState } from "./internal/subscribe.js";

export interface UseStreamOptions<R> {
  /**
   * Run against this runtime instead of the ambient context. When provided, the
   * stream's `R` is constrained to what the runtime provides.
   */
  readonly runtime?: RuntimeLike<R>;
}

export interface UseStreamReturn<A, E> {
  /**
   * The current result state of the stream. `Initial`/`Success` carry a
   * `waiting` flag while the stream is still live (stale-while-revalidate), and
   * settle to a non-waiting `Success`/`Failure` once it completes.
   */
  readonly current: AsyncResult.AsyncResult<ReadonlyArray<A>, E>;

  /**
   * All values emitted by the stream so far
   */
  readonly values: ReadonlyArray<A>;

  /**
   * The most recent value emitted by the stream (undefined if none)
   */
  readonly latest: A | undefined;
}

/**
 * Subscribe to a Stream and collect emissions.
 *
 * The subscription starts the first time `current`/`values`/`latest` is read
 * inside an effect or template, and is interrupted automatically when the last
 * reader is destroyed (via Svelte's `createSubscriber`).
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useStream } from '@thomasfosterau/effect-svelte';
 *   import { Stream, Schedule } from 'effect';
 *
 *   const counter = useStream(
 *     Stream.iterate(0, n => n + 1).pipe(
 *       Stream.schedule(Schedule.spaced('1 second'))
 *     )
 *   );
 * </script>
 *
 * <p>Latest: {counter.latest}</p>
 * <p>All values: {counter.values.join(', ')}</p>
 * ```
 */
export function useStream<A, E, R>(
  stream: Stream.Stream<A, E, R>,
  options: UseStreamOptions<R> = {},
): UseStreamReturn<A, E> {
  const runtime = options.runtime ?? (getRuntime() as RuntimeLike<R>);
  return streamState(runtime, () => stream);
}
