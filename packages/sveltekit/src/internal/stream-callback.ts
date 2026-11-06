/**
 * Internal support for `Stream.callback` sites.
 *
 * @internal
 */

import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";

/**
 * Forwards a failed `Stream.callback` setup to the stream's queue, so the
 * stream ends with the setup's cause: a typed failure fails the stream and a
 * throw caught by `Effect.sync` makes it die. Up to `effect@4.0.1`,
 * `Stream.callback` forked the setup Effect and dropped its cause, so the stream
 * hung instead; later versions forward the cause themselves, and this makes
 * every version in the `^4.0.0` peer range behave like them.
 *
 * Use as `Stream.callback((queue) => setup.pipe(failQueueOnSetupError(queue)))`.
 */
export const failQueueOnSetupError =
  <A, E>(queue: Queue.Queue<A, E | Cause.Done>) =>
  <R>(setup: Effect.Effect<unknown, E, R>): Effect.Effect<unknown, never, R> =>
    Effect.catchCause(setup, (cause) => Queue.failCause(queue, cause));
