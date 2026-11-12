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

import type { NavigationTarget } from "$app/navigation";
import type { Page, navigating as kitNavigating } from "$app/state";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { runSync } from "./run.js";
import { failQueueOnSetupError } from "./stream-callback.js";

/**
 * The fields of SvelteKit's `page` we snapshot, as a plain readonly record
 * rather than the live mutating proxy. It mirrors `$app/state`'s `Page`,
 * except that the fields SvelteKit sets to `null` when there is nothing to
 * report are an `Option` here: `route.id`, `error` and `shallow`. The rest
 * (`url`, `params`, `status`, `data`, `state`, `form`) are SvelteKit's values,
 * unchanged.
 */
export interface PageSnapshot<P extends ReadonlyPage = ReadonlyPage> {
  /** The URL of the page. */
  readonly url: P["url"];
  /** The parameters of the page's route, as SvelteKit types them. */
  readonly params: P["params"];
  /** Info about the page's route. */
  readonly route: {
    /** The ID of the route (such as `/blog/[slug]`): `None` when no route is matched. */
    readonly id: Option.Option<NonNullable<P["route"]["id"]>>;
  };
  /** The HTTP status code of the page. */
  readonly status: P["status"];
  /** The page's error, from the `handleError` hooks: `None` when the page has not failed. */
  readonly error: Option.Option<NonNullable<P["error"]>>;
  /** The merged data of the page's `load` functions. */
  readonly data: P["data"];
  /** The page state set through `goto` / shallow routing. */
  readonly state: P["state"];
  /**
   * The data of the last form action, as SvelteKit passes it on (typed `any`
   * there, and `null` until a form has been submitted).
   */
  readonly form: P["form"];
  /**
   * The target of the current shallow navigation: `None` when no shallow
   * navigation has occurred.
   */
  readonly shallow: Option.Option<NonNullable<P["shallow"]>>;
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
  readonly params: Page["params"];
  readonly route: Readonly<Page["route"]>;
  readonly status: number;
  readonly error: unknown;
  readonly data: App.PageData;
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
 * navigation, so a shallow copy is enough to distinguish snapshots. The
 * fields SvelteKit sets to `null` (`route.id`, `error`, `shallow`) become an
 * `Option`, `None` for `null`.
 */
export function snapshotPage<P extends ReadonlyPage>(page: P): PageSnapshot<P> {
  return {
    url: page.url,
    params: page.params,
    route: { id: Option.fromNullishOr(page.route.id) },
    status: page.status,
    error: Option.fromNullishOr(page.error),
    data: page.data,
    state: page.state,
    form: page.form,
    shallow: Option.fromNullishOr(page.shallow),
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
  const queue = runSync(Queue.unbounded<PageSnapshot<P>>());
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
 * it when the stream ends or is interrupted. Never fails; a throwing `watch`
 * surfaces as a defect (the stream dies with what it threw, with no watcher
 * left to dispose).
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
    ).pipe(failQueueOnSetupError(queue)),
  );
}

// ─── navigating ──────────────────────────────────────────────────────────────

/**
 * A snapshot of an in-flight SvelteKit navigation, copied from `$app/state`'s
 * `navigating`. The fields SvelteKit sets to `null` when there is nothing to
 * report are an `Option` here; a {@link NavigationTarget} is SvelteKit's own
 * object, unchanged.
 */
export interface NavigatingSnapshot {
  /** How the navigation started (`"link"`, `"goto"`, `"popstate"`, `"form"` or `"leave"`). */
  readonly type: InFlightNavigation["type"];
  /** Where the navigation was triggered from: `None` where SvelteKit's `from` is `null`. */
  readonly from: Option.Option<NavigationTarget>;
  /** Where the navigation is going: `None` where SvelteKit's `to` is `null`. */
  readonly to: Option.Option<NavigationTarget>;
  /** Whether the navigation unloads the page (a full-page navigation, not a client-side one). */
  readonly willUnload: boolean;
  /**
   * The number of history steps of a back / forward (`popstate`) navigation:
   * `None` for every other type of navigation.
   */
  readonly delta: Option.Option<number>;
  /**
   * Resolves when the navigation finishes; rejects if it fails or is aborted.
   * It never settles for a navigation that unloads the page.
   */
  readonly complete: Promise<void>;
}

/**
 * The shape of `$app/state`'s `navigating`, as SvelteKit types it: a
 * `Navigation` while one is in flight, and otherwise an object whose fields
 * are all `null`.
 */
export type ReadonlyNavigating = typeof kitNavigating;

/** `$app/state`'s `navigating` while a navigation is in flight (its `type` is not `null`). */
type InFlightNavigation = Exclude<ReadonlyNavigating, { readonly type: null }>;

/**
 * Copies `navigating` into a plain {@link NavigatingSnapshot}, or `None` when
 * no navigation is in flight (`type` is `null`). The snapshot's `from` and `to`
 * are `None` where SvelteKit's are `null`, and its `delta` is `Some` only for a
 * `popstate` navigation, the one type SvelteKit gives a `delta`. Every field of
 * SvelteKit's `navigating` reads the same rune state, so a watcher that runs
 * this tracks the whole object.
 */
export function snapshotNavigating(
  navigating: ReadonlyNavigating,
): Option.Option<NavigatingSnapshot> {
  if (navigating.type === null) return Option.none();
  return Option.some({
    type: navigating.type,
    from: Option.fromNullishOr(navigating.from),
    to: Option.fromNullishOr(navigating.to),
    willUnload: navigating.willUnload,
    delta: navigating.type === "popstate" ? Option.fromNullishOr(navigating.delta) : Option.none(),
    complete: navigating.complete,
  });
}

// ─── updated ─────────────────────────────────────────────────────────────────

/**
 * `updated.check()` rejected. SvelteKit resolves `false` when the version
 * request fails, so this signals misuse (e.g. calling it during server
 * rendering, where there is no `window`) rather than a network error.
 */
export class UpdateCheckError extends Schema.TaggedError<UpdateCheckError>()("UpdateCheckError", {
  /** What `updated.check()` rejected with, or threw. */
  cause: Schema.Defect(),
}) {}

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

/** The service behind `State.CurrentPage`: a snapshot and a stream of page changes. */
export interface CurrentPageService<P extends ReadonlyPage = ReadonlyPage> {
  /** Snapshots the current page when run. */
  readonly get: Effect.Effect<PageSnapshot<P>>;
  /** The current page, then a fresh snapshot whenever any of its fields changes. */
  readonly changes: Stream.Stream<PageSnapshot<P>>;
}

/** Builds a {@link CurrentPageService} reading `readPage()` and watching it with `watch`. */
export function makeCurrentPage<P extends ReadonlyPage>(
  readPage: () => P,
  watch: Watch,
): CurrentPageService<P> {
  const read = (): PageSnapshot<P> => snapshotPage(readPage());
  return { get: Effect.sync(read), changes: watchedStream(watch, read) };
}
