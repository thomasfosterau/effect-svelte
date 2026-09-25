import { Duration, Effect, Match, Predicate, Queue, Stream, String } from "effect";
import { getRuntime } from "./context.svelte.js";
import { runSync, type RuntimeLike } from "./internal/run.js";
import { useStream } from "./stream.svelte.js";

/** The reactive state a debounced search exposes to the template. */
export interface DebouncedSearchState<T> {
  /** A (debounced) search is in flight. Prior `results` are kept meanwhile. */
  readonly pending: boolean;
  /** Latest results (or the prior results while `pending`). */
  readonly results: ReadonlyArray<T>;
  /** Message for a failed search, else `""`. */
  readonly error: string;
}

/** Options for {@link useDebouncedSearch}. */
export interface UseDebouncedSearchOptions<T, E, R> {
  /**
   * Run one search. Must be *interruptible*: when a newer query supersedes it,
   * the in-flight Effect is interrupted, so an Effect `HttpClient` request is
   * aborted rather than merely ignored.
   */
  readonly search: (query: string) => Effect.Effect<ReadonlyArray<T>, E, R>;
  /** Quiet period after the last query change before searching. Defaults to 150 ms. */
  readonly debounce?: Duration.Input | undefined;
  /**
   * Turn a failure into the `error` message. Defaults to an `Error`'s `message`,
   * else `"Search failed."`.
   */
  readonly errorMessage?: ((error: E) => string) | undefined;
  /**
   * Run against this runtime instead of the ambient context. When provided, the
   * search's `R` is constrained to what the runtime provides.
   */
  readonly runtime?: RuntimeLike<R> | undefined;
}

/** The controller returned by {@link useDebouncedSearch}. */
export interface UseDebouncedSearchReturn<T> {
  /** Push the current query. Call from a `$effect` tracking the input, or an `oninput`. */
  readonly emit: (query: string) => void;
  /** Current search state — the stream's latest emission (empty before the first). */
  readonly current: DebouncedSearchState<T>;
}

/** One phase emitted per query before `scan` folds it into a {@link DebouncedSearchState}. */
type Phase<T> =
  | { readonly kind: "empty" }
  | { readonly kind: "pending" }
  | { readonly kind: "done"; readonly results: ReadonlyArray<T> }
  | { readonly kind: "error"; readonly error: string };

const defaultErrorMessage = (error: unknown): string =>
  Predicate.isError(error) ? error.message : "Search failed.";

/**
 * Debounced, latest-wins typeahead search on {@link useStream}.
 *
 * Query changes are pushed into an Effect `Stream`, `debounce`d, and
 * `switchMap`ped into the interruptible `search` Effect — so a superseded request
 * is aborted and its late result can never clobber a newer one. A `scan` keeps
 * the previous results while a new search is in flight
 * (stale-while-revalidate), and an empty (or whitespace-only) query resets the
 * state without searching.
 *
 * Queries are buffered through an Effect `Queue` (`Stream.fromQueue`), not
 * {@link SignalEmitter}: a queue is a durable buffer, so a query emitted on any
 * later tick (every keystroke fires after mount) is delivered.
 *
 * Call during component initialisation; the component must be a descendant of
 * `provideRuntime()` unless `runtime` is given.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useDebouncedSearch } from "@thomasfosterau/effect-svelte";
 *   import { searchUsers } from "$lib/api";
 *
 *   let query = $state("");
 *   const search = useDebouncedSearch({ search: searchUsers, debounce: "200 millis" });
 *   $effect(() => search.emit(query));
 * </script>
 *
 * <input bind:value={query} />
 * <ul aria-busy={search.current.pending}>
 *   {#each search.current.results as user (user.id)}<li>{user.name}</li>{/each}
 * </ul>
 * {#if search.current.error}<p role="alert">{search.current.error}</p>{/if}
 * ```
 */
export function useDebouncedSearch<T, E = never, R = never>(
  options: UseDebouncedSearchOptions<T, E, R>,
): UseDebouncedSearchReturn<T> {
  const runtime = options.runtime ?? (getRuntime() as RuntimeLike<R>);
  const debounce = options.debounce ?? Duration.millis(150);
  const errorMessage: (error: E) => string = options.errorMessage ?? defaultErrorMessage;
  const empty: DebouncedSearchState<T> = { pending: false, results: [], error: "" };

  // Folds each phase into the view state; stale-while-revalidate on `pending`.
  const step = (previous: DebouncedSearchState<T>, phase: Phase<T>): DebouncedSearchState<T> =>
    Match.value(phase).pipe(
      Match.discriminatorsExhaustive("kind")({
        empty: () => empty,
        pending: () => ({ pending: true, results: previous.results, error: "" }),
        done: (done) => ({ pending: false, results: done.results, error: "" }),
        error: (failed) => ({ pending: false, results: [], error: failed.error }),
      }),
    );

  // Created synchronously so `emit` can offer into it immediately; `unbounded`
  // is pure allocation, so `runSync` cannot suspend.
  const queries = runSync(runtime)(Queue.unbounded<string>());

  const stream = Stream.fromQueue(queries).pipe(
    Stream.debounce(debounce),
    Stream.switchMap((raw): Stream.Stream<Phase<T>, never, R> => {
      const query = raw.trim();
      if (String.isEmpty(query)) return Stream.succeed<Phase<T>>({ kind: "empty" });
      return Stream.concat(
        Stream.succeed<Phase<T>>({ kind: "pending" }),
        Stream.fromEffect(
          options.search(query).pipe(
            Effect.match({
              onSuccess: (results): Phase<T> => ({ kind: "done", results }),
              onFailure: (error): Phase<T> => ({ kind: "error", error: errorMessage(error) }),
            }),
          ),
        ),
      );
    }),
    Stream.scan(empty, step),
  );

  const view = useStream(stream, { runtime });

  return {
    emit: (query) => {
      Queue.offerUnsafe(queries, query);
    },
    get current() {
      return view.latest ?? empty;
    },
  };
}
