/**
 * Pure, `$app/navigation`-free core for the navigation-event bridge in
 * `../navigation-events.ts`.
 *
 * The public helpers can't be unit-tested directly because importing them pulls
 * in `$app/navigation` (a SvelteKit virtual module that only exists inside a
 * build). The queue → stream plumbing and the run-per-navigation + cleanup
 * forwarding live here instead, parameterised over the callback registrar, so
 * they can be driven with a stand-in registrar in tests while the public
 * wrappers stay a thin pass-through of SvelteKit's real functions.
 *
 * @internal
 */

import { Effect, Queue, Stream } from "effect";

/**
 * Registers `register`'s callback against a fresh unbounded queue and exposes
 * that queue as a `Stream`. The callback is wired synchronously (so the public
 * wrappers register during component init, where `$app/navigation` requires);
 * each value offered through it is later yielded by the stream.
 */
export function registeredStream<A>(
  register: (callback: (value: A) => void) => void,
): Stream.Stream<A> {
  const queue = Effect.runSync(Queue.unbounded<A>());
  register((value) => {
    Queue.offerUnsafe(queue, value);
  });
  return Stream.fromQueue(queue);
}

/**
 * Registers `register`'s callback so that each navigation runs `fn` via
 * `runEffect`, forwarding any cleanup function the resolved Effect produces back
 * to the registrar (SvelteKit awaits it before completing the navigation and
 * runs the returned cleanup once the DOM has updated).
 */
export function onNavigateWith<A>(
  register: (callback: (value: A) => Promise<(() => void) | void> | (() => void) | void) => void,
  fn: (navigation: A) => Effect.Effect<(() => void) | void>,
  runEffect: <X>(effect: Effect.Effect<X>) => Promise<X>,
): void {
  register((navigation) => runEffect(fn(navigation)));
}
