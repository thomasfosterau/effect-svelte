/**
 * Pure, `$app/*`-free core for the `$app/state` bridge in `../app-state.ts`.
 *
 * The public `pageStream` can't be unit-tested directly because importing it
 * pulls in `$app/navigation` and `$app/state` (SvelteKit virtual modules that
 * only exist inside a build). The snapshotting and the "emit now, then after
 * each navigation" plumbing live here instead, parameterised over the
 * navigation registrar and a `readPage` thunk, so they can be driven with
 * stand-ins in tests while the public wrapper stays a thin pass-through.
 *
 * @internal
 */

import { Effect, Queue, Stream } from "effect";

/**
 * The fields of SvelteKit's `page` we snapshot. Mirrors the shape of
 * `@sveltejs/kit`'s `Page`, but as a plain readonly record rather than the live
 * mutating proxy.
 */
export interface PageSnapshot<P extends ReadonlyPage = ReadonlyPage> {
  readonly url: P["url"];
  readonly params: P["params"];
  readonly route: P["route"];
  readonly status: P["status"];
  readonly error: P["error"];
  readonly data: P["data"];
  readonly state: P["state"];
  readonly form: P["form"];
}

/**
 * The subset of `Page` fields the snapshot reads. Deliberately loose (the value
 * types are `unknown` / broad) so SvelteKit's `Page` — whose `params` / `data`
 * / `error` / `state` are app-specific — satisfies the constraint, while
 * `PageSnapshot<P>` recovers the precise field types from `P`.
 */
export interface ReadonlyPage {
  readonly url: URL;
  readonly params: Record<string, string | undefined>;
  readonly route: { readonly id: string | null };
  readonly status: number;
  readonly error: unknown;
  readonly data: Record<string, unknown>;
  readonly state: unknown;
  readonly form: unknown;
}

/**
 * Builds a shallow snapshot of the `page` fields that matter. We copy the
 * fields rather than forwarding the live `$app/state` proxy so downstream Effect
 * consumers see a stable value (the proxy mutates in place on every
 * navigation, which would make a captured reference unreliable). Nested values
 * (`url`, `data`, ...) are *not* deep-cloned: they're replaced wholesale on each
 * navigation, so a shallow copy is enough to distinguish snapshots.
 */
export function snapshotPage<P extends ReadonlyPage>(page: P): PageSnapshot<P> {
  return {
    url: page.url,
    params: page.params,
    route: page.route,
    status: page.status,
    error: page.error,
    data: page.data,
    state: page.state,
    form: page.form,
  };
}

/**
 * Emits a snapshot of `readPage()` immediately, then again every time
 * `registerAfterNavigate`'s callback fires (i.e. after each navigation). Backed
 * by an unbounded queue, exposed as a `Stream` — the same push bridge as the
 * navigation-event helpers.
 */
export function pageSnapshotStream<P extends ReadonlyPage>(
  registerAfterNavigate: (callback: () => void) => void,
  readPage: () => P,
): Stream.Stream<PageSnapshot<P>> {
  const queue = Effect.runSync(Queue.unbounded<PageSnapshot<P>>());
  // Initial value: the current page, so consumers start from a known state.
  Queue.offerUnsafe(queue, snapshotPage(readPage()));
  // afterNavigate fires once on mount too, but emitting up front means a
  // late-subscribing consumer still sees the current page without waiting for a
  // navigation.
  registerAfterNavigate(() => {
    Queue.offerUnsafe(queue, snapshotPage(readPage()));
  });
  return Stream.fromQueue(queue);
}
