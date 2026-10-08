/**
 * Pure, `$app/*`-free core for the `$app/state` bridge in `../State.ts`.
 *
 * The public helpers can't be unit-tested in plain Node because importing them
 * pulls in `$app/navigation` and `$app/state` (SvelteKit virtual modules that
 * only exist inside a build). The snapshotting, the "emit now, then after each
 * navigation" plumbing and the watch-to-`Stream` bridge live here instead,
 * parameterised over the navigation registrar, a {@link Watch} function and
 * read thunks, so they can be driven with stand-ins in tests while the public
 * wrappers stay thin pass-throughs. The only runes code is `watch.svelte.ts`.
 *
 * @internal
 */

import type { NavigationTarget, NavigationType } from "$app/navigation";
import { Data, Effect, Option, Queue, Stream } from "effect";

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
  readonly shallow: P["shallow"];
}

/**
 * The subset of `Page` fields the snapshot reads. Deliberately loose (the value
 * types are `unknown` / broad) so SvelteKit's `Page` — whose `params` / `data`
 * / `error` / `state` are app-specific — satisfies the constraint, while
 * `PageSnapshot<P>` recovers the precise field types from `P`.
 */
export interface ReadonlyPage {
  // SvelteKit 3 types `page.url` as an immutable `ReadonlyURL` (from
  // `$app/state`); everything but `searchParams` is enough here.
  readonly url: Readonly<Omit<URL, "searchParams">>;
  readonly params: Record<string, string | undefined>;
  readonly route: { readonly id: string | null };
  readonly status: number;
  readonly error: unknown;
  readonly data: Record<string, unknown>;
  readonly state: unknown;
  readonly form: unknown;
  // SvelteKit 3: the target of the current shallow navigation, or `null`.
  readonly shallow: unknown;
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
    shallow: page.shallow,
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

// ─── Watching rune state ─────────────────────────────────────────────────────

/**
 * Observes a reactive read: calls `onValue` with `read()` once, then again
 * whenever something `read` touched changes, until the returned disposer runs.
 * The real implementation is `watch` in `./watch.svelte.ts`.
 */
export type Watch = <A>(read: () => A, onValue: (value: A) => void) => () => void;

/**
 * A `Stream` of `read()`: the current value, then a new one each time `watch`
 * reports a change. Cold and lazy — each run opens its own watcher and disposes
 * it when the stream ends or is interrupted.
 */
export function watchedStream<A>(watch: Watch, read: () => A): Stream.Stream<A> {
  return Stream.callback<A>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() =>
        watch(read, (value) => {
          Queue.offerUnsafe(queue, value);
        }),
      ),
      (dispose) => Effect.sync(dispose),
    ),
  );
}

// ─── navigating ──────────────────────────────────────────────────────────────

/**
 * A snapshot of an in-flight SvelteKit navigation, as `$app/state`'s
 * `navigating` exposes it. `delta` is the history step count for a `popstate`
 * navigation and `null` otherwise; `complete` resolves when the navigation
 * finishes and rejects if it fails or is aborted.
 */
export interface NavigatingSnapshot {
  readonly type: Exclude<NavigationType, "enter">;
  readonly from: NavigationTarget | null;
  readonly to: NavigationTarget | null;
  readonly willUnload: boolean;
  readonly delta: number | null;
  readonly complete: Promise<void>;
}

/**
 * The shape of `$app/state`'s `navigating`: every field is `null` while no
 * navigation is in flight.
 */
export interface ReadonlyNavigating {
  readonly type: NavigatingSnapshot["type"] | null;
  readonly from: NavigationTarget | null;
  readonly to: NavigationTarget | null;
  readonly willUnload: boolean | null;
  readonly delta?: number | null | undefined;
  readonly complete: Promise<void> | null;
}

/**
 * Copies `navigating` into a plain {@link NavigatingSnapshot}, or `None` when
 * no navigation is in flight (`type` is `null`). Reads every field, so a
 * watcher tracks the whole object.
 */
export function snapshotNavigating(
  navigating: ReadonlyNavigating,
): Option.Option<NavigatingSnapshot> {
  const { type, from, to, willUnload, delta, complete } = navigating;
  if (type === null || willUnload === null || complete === null) return Option.none();
  return Option.some({ type, from, to, willUnload, delta: delta ?? null, complete });
}

// ─── updated ─────────────────────────────────────────────────────────────────

/**
 * `updated.check()` rejected. SvelteKit resolves `false` when the version
 * request fails, so this signals misuse (e.g. calling it during server
 * rendering, where there is no `window`) rather than a network error.
 */
export class UpdateCheckError extends Data.TaggedError("UpdateCheckError")<{
  readonly cause: unknown;
}> {}

/**
 * Runs `check` (SvelteKit's `updated.check`) as an Effect that succeeds with
 * whether a new version is available and fails with {@link UpdateCheckError}
 * if the promise rejects (or `check` throws).
 */
export function checkForUpdateWith(
  check: () => Promise<boolean>,
): Effect.Effect<boolean, UpdateCheckError> {
  return Effect.tryPromise({
    try: () => check(),
    catch: (cause) => new UpdateCheckError({ cause }),
  });
}

// ─── CurrentPage ─────────────────────────────────────────────────────────────

/** The service shape behind `State.CurrentPage`. */
export interface CurrentPageShape<P extends ReadonlyPage = ReadonlyPage> {
  /** Snapshots the current page when run. */
  readonly get: Effect.Effect<PageSnapshot<P>>;
  /** The current page, then a fresh snapshot whenever any of its fields changes. */
  readonly changes: Stream.Stream<PageSnapshot<P>>;
}

/** Builds a {@link CurrentPageShape} reading `readPage()` and watching it with `watch`. */
export function makeCurrentPage<P extends ReadonlyPage>(
  readPage: () => P,
  watch: Watch,
): CurrentPageShape<P> {
  const read = (): PageSnapshot<P> => snapshotPage(readPage());
  return { get: Effect.sync(read), changes: watchedStream(watch, read) };
}
