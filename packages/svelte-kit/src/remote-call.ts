import type {
  RemoteCommand,
  RemotePrerenderFunction,
  RemoteQuery,
  RemoteQueryFunction,
  RemoteQueryOverride,
} from "@sveltejs/kit";
import { Effect } from "effect";

function fromRemotePromise<A>(thunk: () => PromiseLike<A>): Effect.Effect<A, unknown, never> {
  return Effect.promise(() => Promise.resolve(thunk()));
}

export function callQuery<Output>(query: RemoteQueryFunction<void, Output>): Effect.Effect<Awaited<Output>, unknown, never>;
export function callQuery<Input, Output>(
  query: RemoteQueryFunction<Input, Output>,
  input: Input
): Effect.Effect<Awaited<Output>, unknown, never>;
export function callQuery<Input, Output>(
  query: RemoteQueryFunction<Input, Output>,
  input?: Input
): Effect.Effect<Awaited<Output>, unknown, never> {
  if (arguments.length === 1) {
    return fromRemotePromise(() => (query as unknown as RemoteQueryFunction<void, Output>)(undefined));
  }

  return fromRemotePromise(() => query(input as Input));
}

export function callCommand<Output>(command: RemoteCommand<void, Output>): Effect.Effect<Awaited<Output>, unknown, never>;
export function callCommand<Input, Output>(
  command: RemoteCommand<Input, Output>,
  input: Input
): Effect.Effect<Awaited<Output>, unknown, never>;
export function callCommand<Input, Output>(
  command: RemoteCommand<Input, Output>,
  input?: Input
): Effect.Effect<Awaited<Output>, unknown, never> {
  if (arguments.length === 1) {
    return fromRemotePromise(() => (command as unknown as RemoteCommand<void, Output>)(undefined));
  }

  return fromRemotePromise(() => command(input as Input));
}

export function callPrerender<Output>(
  prerender: RemotePrerenderFunction<void, Output>
): Effect.Effect<Awaited<Output>, unknown, never>;
export function callPrerender<Input, Output>(
  prerender: RemotePrerenderFunction<Input, Output>,
  input: Input
): Effect.Effect<Awaited<Output>, unknown, never>;
export function callPrerender<Input, Output>(
  prerender: RemotePrerenderFunction<Input, Output>,
  input?: Input
): Effect.Effect<Awaited<Output>, unknown, never> {
  if (arguments.length === 1) {
    return fromRemotePromise(() => (prerender as unknown as RemotePrerenderFunction<void, Output>)(undefined));
  }

  return fromRemotePromise(() => prerender(input as Input));
}

export type RemoteSubmit = () => Promise<void> & {
  updates: (...queries: Array<RemoteQuery<any> | RemoteQueryOverride>) => Promise<void>;
};

export function submitForm(submit: () => Promise<void>): Effect.Effect<void, unknown, never> {
  return fromRemotePromise(() => submit());
}

export function submitFormWithUpdates(
  submit: RemoteSubmit,
  ...queries: Array<RemoteQuery<any> | RemoteQueryOverride>
): Effect.Effect<void, unknown, never> {
  return fromRemotePromise(() => submit().updates(...queries));
}
