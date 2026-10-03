import type {
  RemoteCommand,
  RemoteLiveQuery,
  RemotePrerenderFunction,
  RemoteQuery,
  RemoteQueryFunction,
  RemoteQueryOverride,
} from "$app/server";
import { Effect, Stream } from "effect";

function fromRemotePromise<A>(thunk: () => PromiseLike<A>): Effect.Effect<A, unknown, never> {
  return Effect.promise(() => Promise.resolve(thunk()));
}

/**
 * Calls a SvelteKit remote `query` as an Effect that succeeds with its output.
 *
 * A rejected call (including a thrown `error()` / `redirect()`) surfaces as a
 * defect, not on the error channel, despite the declared `unknown` error type.
 */
export function callQuery<Output>(
  query: RemoteQueryFunction<void, Output>,
): Effect.Effect<Output, unknown, never>;
/**
 * Calls a SvelteKit remote `query` with `input` as an Effect that succeeds
 * with its output.
 *
 * A rejected call (including a thrown `error()` / `redirect()`) surfaces as a
 * defect, not on the error channel, despite the declared `unknown` error type.
 */
export function callQuery<Input, Output>(
  query: RemoteQueryFunction<Input, Output>,
  input: Input,
): Effect.Effect<Output, unknown, never>;
export function callQuery<Input, Output>(
  query: RemoteQueryFunction<Input, Output>,
  input?: Input,
): Effect.Effect<Output, unknown, never> {
  if (arguments.length === 1) {
    return fromRemotePromise(() =>
      (query as unknown as RemoteQueryFunction<void, Output>)(undefined),
    );
  }

  return fromRemotePromise(() => query(input as Input));
}

/**
 * Calls a SvelteKit remote `command` as an Effect that succeeds with its
 * output.
 *
 * A rejected call (including a thrown `error()` / `redirect()`) surfaces as a
 * defect, not on the error channel, despite the declared `unknown` error type.
 */
export function callCommand<Output>(
  command: RemoteCommand<void, Output>,
): Effect.Effect<Output, unknown, never>;
/**
 * Calls a SvelteKit remote `command` with `input` as an Effect that succeeds
 * with its output.
 *
 * A rejected call (including a thrown `error()` / `redirect()`) surfaces as a
 * defect, not on the error channel, despite the declared `unknown` error type.
 */
export function callCommand<Input, Output>(
  command: RemoteCommand<Input, Output>,
  input: Input,
): Effect.Effect<Output, unknown, never>;
export function callCommand<Input, Output>(
  command: RemoteCommand<Input, Output>,
  input?: Input,
): Effect.Effect<Output, unknown, never> {
  if (arguments.length === 1) {
    return fromRemotePromise(() => (command as unknown as RemoteCommand<void, Output>)(undefined));
  }

  return fromRemotePromise(() => command(input as Input));
}

/**
 * Calls a remote command and refreshes the given queries in the same round
 * trip (SvelteKit's single-flight mutations).
 *
 * Newer SvelteKit versions cache remote query instances, so a command that
 * changes data those queries depend on must list them here (or call
 * `query.refresh()` afterwards) for their cached values to update.
 *
 * A rejected call (including a thrown `error()` / `redirect()`) surfaces as a
 * defect, not on the error channel, despite the declared `unknown` error type.
 */
export function callCommandWithUpdates<Input, Output>(
  command: RemoteCommand<Input, Output>,
  input: Input,
  ...queries: Array<RemoteQuery<any> | RemoteQueryOverride>
): Effect.Effect<Output, unknown, never> {
  return fromRemotePromise(() => command(input).updates(...queries));
}

/**
 * Calls a SvelteKit remote `prerender` function as an Effect that succeeds
 * with its output.
 *
 * A rejected call (including a thrown `error()` / `redirect()`) surfaces as a
 * defect, not on the error channel, despite the declared `unknown` error type.
 */
export function callPrerender<Output>(
  prerender: RemotePrerenderFunction<void, Output>,
): Effect.Effect<Output, unknown, never>;
/**
 * Calls a SvelteKit remote `prerender` function with `input` as an Effect
 * that succeeds with its output.
 *
 * A rejected call (including a thrown `error()` / `redirect()`) surfaces as a
 * defect, not on the error channel, despite the declared `unknown` error type.
 */
export function callPrerender<Input, Output>(
  prerender: RemotePrerenderFunction<Input, Output>,
  input: Input,
): Effect.Effect<Output, unknown, never>;
export function callPrerender<Input, Output>(
  prerender: RemotePrerenderFunction<Input, Output>,
  input?: Input,
): Effect.Effect<Output, unknown, never> {
  if (arguments.length === 1) {
    return fromRemotePromise(() =>
      (prerender as unknown as RemotePrerenderFunction<void, Output>)(undefined),
    );
  }

  return fromRemotePromise(() => prerender(input as Input));
}

/**
 * The shape of an enhanced remote form `submit` function. The promise result
 * is left open (SvelteKit returns `Promise<void>` in older versions and
 * `Promise<boolean>` in newer ones).
 */
export type RemoteSubmit = () => PromiseLike<unknown> & {
  updates: (...queries: Array<RemoteQuery<any> | RemoteQueryOverride>) => PromiseLike<unknown>;
};

/**
 * Runs an enhanced remote form's `submit()` as an Effect.
 *
 * A rejected call (including a thrown `error()` / `redirect()`) surfaces as a
 * defect, not on the error channel, despite the declared `unknown` error type.
 */
export function submitForm(
  submit: () => PromiseLike<unknown>,
): Effect.Effect<void, unknown, never> {
  return Effect.asVoid(fromRemotePromise(() => submit()));
}

/**
 * Runs an enhanced remote form's `submit()` and refreshes the given queries in
 * the same round trip (SvelteKit's single-flight mutations).
 *
 * A rejected call (including a thrown `error()` / `redirect()`) surfaces as a
 * defect, not on the error channel, despite the declared `unknown` error type.
 */
export function submitFormWithUpdates(
  submit: RemoteSubmit,
  ...queries: Array<RemoteQuery<any> | RemoteQueryOverride>
): Effect.Effect<void, unknown, never> {
  return Effect.asVoid(fromRemotePromise(() => submit().updates(...queries)));
}

/**
 * Consumes a SvelteKit live query (`query.live(...)`) as an Effect `Stream`.
 *
 * A `RemoteLiveQuery<T>` is an `AsyncIterable<T>` that yields every update
 * pushed from the server; this turns it into a `Stream` so live data can drive
 * Effect pipelines (and, via `useStream`, Svelte runes).
 *
 * @example
 * ```ts
 * import { Remote } from '@thomasfosterau/effect-sveltekit';
 * import { messages } from './chat.remote';
 * import { useStream } from '@thomasfosterau/effect-svelte';
 *
 * const feed = useStream(Remote.liveQueryStream(messages()));
 * ```
 */
export function liveQueryStream<Output>(
  query: RemoteLiveQuery<Output>,
): Stream.Stream<Output, unknown> {
  return Stream.fromAsyncIterable(query, (error) => error);
}
