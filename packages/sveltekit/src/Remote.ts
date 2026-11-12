import type {
  RemoteCommand,
  RemoteLiveQuery,
  RemotePrerenderFunction,
  RemoteQuery,
  RemoteQueryFunction,
  RemoteQueryOverride,
} from "$app/server";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

/**
 * Wraps a remote call so a rejection, or a synchronous throw from `thunk`,
 * fails the Effect with the original reason instead of becoming a defect.
 */
function fromRemotePromise<A>(thunk: () => PromiseLike<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({
    try: () => Promise.resolve(thunk()),
    catch: (error) => error,
  });
}

/**
 * A remote function as `call*` calls it: SvelteKit's own parameter (optional
 * exactly when `Input` admits `undefined`) and a promise of the output.
 */
type RemoteCall<Input, Output> = (
  arg: undefined extends Input ? Input | void : Input,
) => PromiseLike<Output>;

/**
 * The two ways a `call*` function is called, as its overloads spell them: with
 * a remote function that takes no input, or with one and its input.
 */
type RemoteCallArgs<NoInput, WithInput, Input> =
  | readonly [remote: NoInput]
  | readonly [remote: WithInput, input: Input];

/**
 * Calls a remote function, with its input when one was passed, as an Effect
 * that fails with the call's rejection reason.
 */
function callRemote<Input, Output>(
  ...args: RemoteCallArgs<RemoteCall<void, Output>, RemoteCall<Input, Output>, Input>
): Effect.Effect<Output, unknown> {
  if (args.length === 1) {
    const [remote] = args;
    return fromRemotePromise(() => remote(undefined));
  }
  const [remote, input] = args;
  return fromRemotePromise(() => remote(input));
}

/**
 * Calls a SvelteKit remote `query` as an Effect that succeeds with its output.
 *
 * Fails with the remote call's rejection reason, typed `unknown` and passed
 * through unchanged. On the client, a server-side `error()` arrives as
 * SvelteKit's `HttpError`; a server-side `redirect()` navigates instead of
 * failing.
 */
export function callQuery<Output>(
  query: RemoteQueryFunction<void, Output>,
): Effect.Effect<Output, unknown>;
/**
 * Calls a SvelteKit remote `query` with `input` as an Effect that succeeds
 * with its output.
 *
 * Fails with the remote call's rejection reason, typed `unknown` and passed
 * through unchanged. On the client, a server-side `error()` arrives as
 * SvelteKit's `HttpError`; a server-side `redirect()` navigates instead of
 * failing.
 */
export function callQuery<Input, Output>(
  query: RemoteQueryFunction<Input, Output>,
  input: Input,
): Effect.Effect<Output, unknown>;
export function callQuery<Input, Output>(
  ...args: RemoteCallArgs<
    RemoteQueryFunction<void, Output>,
    RemoteQueryFunction<Input, Output>,
    Input
  >
): Effect.Effect<Output, unknown> {
  return callRemote(...args);
}

/**
 * Calls a SvelteKit remote `command` as an Effect that succeeds with its
 * output.
 *
 * Fails with the remote call's rejection reason, typed `unknown` and passed
 * through unchanged. On the client, a server-side `error()` arrives as
 * SvelteKit's `HttpError`; commands may not `redirect()`, and SvelteKit
 * rejects one with an `Error`.
 */
export function callCommand<Output>(
  command: RemoteCommand<void, Output>,
): Effect.Effect<Output, unknown>;
/**
 * Calls a SvelteKit remote `command` with `input` as an Effect that succeeds
 * with its output.
 *
 * Fails with the remote call's rejection reason, typed `unknown` and passed
 * through unchanged. On the client, a server-side `error()` arrives as
 * SvelteKit's `HttpError`; commands may not `redirect()`, and SvelteKit
 * rejects one with an `Error`.
 */
export function callCommand<Input, Output>(
  command: RemoteCommand<Input, Output>,
  input: Input,
): Effect.Effect<Output, unknown>;
export function callCommand<Input, Output>(
  ...args: RemoteCallArgs<RemoteCommand<void, Output>, RemoteCommand<Input, Output>, Input>
): Effect.Effect<Output, unknown> {
  return callRemote(...args);
}

/**
 * Calls a remote command and refreshes the given queries in the same round
 * trip (SvelteKit's single-flight mutations).
 *
 * Newer SvelteKit versions cache remote query instances, so a command that
 * changes data those queries depend on must list them here (or call
 * `query.refresh()` afterwards) for their cached values to update.
 *
 * Fails with the remote call's rejection reason, typed `unknown` and passed
 * through unchanged. On the client, a server-side `error()` arrives as
 * SvelteKit's `HttpError`; commands may not `redirect()`, and SvelteKit
 * rejects one with an `Error`.
 */
export function callCommandWithUpdates<Input, Output>(
  command: RemoteCommand<Input, Output>,
  input: Input,
  ...queries: Array<RemoteQuery<any> | RemoteQueryOverride>
): Effect.Effect<Output, unknown> {
  return fromRemotePromise(() => command(input).updates(...queries));
}

/**
 * Calls a SvelteKit remote `prerender` function as an Effect that succeeds
 * with its output.
 *
 * Fails with the remote call's rejection reason, typed `unknown` and passed
 * through unchanged. On the client, a server-side `error()` arrives as
 * SvelteKit's `HttpError`; a server-side `redirect()` navigates instead of
 * failing.
 */
export function callPrerender<Output>(
  prerender: RemotePrerenderFunction<void, Output>,
): Effect.Effect<Output, unknown>;
/**
 * Calls a SvelteKit remote `prerender` function with `input` as an Effect
 * that succeeds with its output.
 *
 * Fails with the remote call's rejection reason, typed `unknown` and passed
 * through unchanged. On the client, a server-side `error()` arrives as
 * SvelteKit's `HttpError`; a server-side `redirect()` navigates instead of
 * failing.
 */
export function callPrerender<Input, Output>(
  prerender: RemotePrerenderFunction<Input, Output>,
  input: Input,
): Effect.Effect<Output, unknown>;
export function callPrerender<Input, Output>(
  ...args: RemoteCallArgs<
    RemotePrerenderFunction<void, Output>,
    RemotePrerenderFunction<Input, Output>,
    Input
  >
): Effect.Effect<Output, unknown> {
  return callRemote(...args);
}

/**
 * The shape of an enhanced remote form `submit` function, as SvelteKit 3's
 * `RemoteForm.submit`: it resolves with whether the submission was valid, and
 * `updates` refreshes queries in the same round trip.
 */
export type RemoteSubmit = () => PromiseLike<boolean> & {
  updates: (...queries: Array<RemoteQuery<any> | RemoteQueryOverride>) => PromiseLike<boolean>;
};

/**
 * Runs an enhanced remote form's `submit()` as an Effect.
 *
 * Fails with the remote call's rejection reason, typed `unknown` and passed
 * through unchanged. On the client, a server-side `error()` arrives as
 * SvelteKit's `HttpError`; a server-side `redirect()` navigates instead of
 * failing.
 */
export function submitForm(submit: () => PromiseLike<boolean>): Effect.Effect<void, unknown> {
  return Effect.asVoid(fromRemotePromise(() => submit()));
}

/**
 * Runs an enhanced remote form's `submit()` and refreshes the given queries in
 * the same round trip (SvelteKit's single-flight mutations).
 *
 * Fails with the remote call's rejection reason, typed `unknown` and passed
 * through unchanged. On the client, a server-side `error()` arrives as
 * SvelteKit's `HttpError`; a server-side `redirect()` navigates instead of
 * failing.
 */
export function submitFormWithUpdates(
  submit: RemoteSubmit,
  ...queries: Array<RemoteQuery<any> | RemoteQueryOverride>
): Effect.Effect<void, unknown> {
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
