/**
 * Typed stand-ins for what SvelteKit's remote functions are and return on the
 * client, for the tests of the `Remote` call helpers: a remote function that
 * serves as a `query`, a `command` and a `prerender` at once, the result of
 * calling one, and a live query.
 */

import type { RemoteLiveQuery } from "$app/server";

/** The state every remote resource reports before its first result. */
const notReady = { error: undefined, loading: true, current: undefined, ready: false } as const;

/**
 * The result of calling a remote function: `promise` as a `RemoteQuery` (which
 * is also a `prerender`'s `RemoteResource`), with the `updates()` a `command`
 * or an enhanced form's `submit()` result has. `set` and `refresh` do nothing.
 */
export const remoteResult = <A>(
  promise: Promise<A>,
  updates: (...queries: ReadonlyArray<unknown>) => Promise<A>,
) =>
  Object.assign(promise, notReady, {
    set: () => {},
    refresh: () => Promise.resolve(),
    withOverride: () => () => {},
    updates,
  });

/** What {@link remoteResult} returns for a result of `A`. */
export type RemoteResult<A> = ReturnType<typeof remoteResult<A>>;

/**
 * A remote function over `call`: callable as a `query`, a `prerender` and (with
 * nothing pending) a `command`, with or without its `string` input.
 */
export const remoteFunction = <A>(call: (input: string | void) => RemoteResult<A>) =>
  Object.assign(call, { pending: 0 });

/**
 * A live query that yields what `iterable` yields. It never resolves as a
 * promise and reports itself connected.
 */
export const remoteLiveQuery = <A>(iterable: AsyncIterable<A>): RemoteLiveQuery<A> =>
  Object.assign(new Promise<A>(() => {}), notReady, {
    [Symbol.asyncIterator]: () => iterable[Symbol.asyncIterator](),
    connected: true,
    done: false,
    reconnect: () => Promise.resolve(),
  });
