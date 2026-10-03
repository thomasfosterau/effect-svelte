/**
 * Svelte 5 runes binding for Effect's reactivity atoms
 * (`effect/reactivity`).
 *
 * Effect ships first-party atom bindings for React, Solid and Vue but, as of
 * this writing, none for Svelte. This module is that binding — the bridge until
 * an official `@effect/atom-svelte` lands (#23), deliberately kept small so it
 * can be swapped for it: the registry, the caching, the request de-duplication
 * and the keyed invalidation all live in Effect; this module only wires a
 * registry subscription to Svelte's dependency tracker. Consumers reach the
 * registry through {@link makeAtomRegistry} / {@link provideAtomRegistry} /
 * {@link invalidateAtomKeys} rather than `AtomRegistry` directly, so the
 * implementation behind them can change without touching call sites.
 *
 * The seam is `createSubscriber` (`svelte/reactivity`) rather than a `$state`
 * mirror: it starts the registry subscription lazily when a rune effect first
 * reads the value and tears it down when the last reader goes away, which is
 * exactly the atom registry's own mount/dispose lifecycle.
 *
 * @module
 */

import { Context, Effect, Layer, Option, Schema, Scope } from "effect";
import { AsyncResult, Atom, AtomRegistry as Registry, Reactivity } from "effect/reactivity";
import { createContext } from "svelte";
import { createSubscriber } from "svelte/reactivity";

/**
 * The store behind every atom a component reads: it evaluates each atom once,
 * keeps its value, tracks who depends on it and disposes nodes nothing is
 * mounted on.
 */
export type AtomRegistry = Registry.AtomRegistry;

/** Options for {@link makeAtomRegistry}. */
export interface MakeAtomRegistryOptions {
  /**
   * How long (in milliseconds) an atom nothing is subscribed to survives before
   * the registry disposes it. A short TTL lets a remount (navigating away and
   * straight back, a section re-created during hydration) re-read the cache
   * instead of re-fetching. Defaults to Effect's own default (dispose at once).
   */
  readonly defaultIdleTTL?: number | undefined;
  /** Initial atom values, e.g. dehydrated server state. */
  readonly initialValues?: Iterable<readonly [Atom.Atom<any>, any]> | undefined;
}

/**
 * Raised when an atom registry is reached where none can exist: the implicit
 * browser registry during SSR, or a registry whose `Reactivity` service has not
 * resolved.
 */
export class AtomRegistryUnavailable extends Schema.TaggedError<AtomRegistryUnavailable>()(
  "AtomRegistryUnavailable",
  { message: Schema.String },
) {}

/**
 * Build a new atom registry.
 *
 * @example
 * ```ts
 * import { makeAtomRegistry } from "@thomasfosterau/effect-svelte";
 *
 * // Keep a query's value for 30s after its last reader unmounts.
 * const registry = makeAtomRegistry({ defaultIdleTTL: 30_000 });
 * ```
 */
export const makeAtomRegistry = (options: MakeAtomRegistryOptions = {}): AtomRegistry =>
  Registry.make(options);

const isBrowser = (): boolean => typeof window !== "undefined";

/** The implicit browser registry, once built. `None` is "not created yet". */
let browserRegistry: Option.Option<AtomRegistry> = Option.none();

/**
 * The implicit browser registry, created on first use with Effect's default
 * options. Throws {@link AtomRegistryUnavailable} on the server: a registry is
 * browser state, and silently building one per SSR request would issue fetches
 * whose values are discarded.
 */
const defaultAtomRegistry = (): AtomRegistry => {
  if (!isBrowser()) {
    throw new AtomRegistryUnavailable({
      message:
        "effect-svelte: the default atom registry is browser-only — atoms are not evaluated " +
        "during SSR. Pass a registry explicitly, or provideAtomRegistry() one.",
    });
  }
  const made = Option.getOrElse(browserRegistry, () => makeAtomRegistry());
  browserRegistry = Option.some(made);
  return made;
};

const [getContextRegistry, setContextRegistry] = createContext<AtomRegistry>();

/**
 * Make `registry` the one every atom hook below this component reads from.
 *
 * Optional: without it, the hooks share one implicit browser registry. Provide
 * one to configure it (e.g. `defaultIdleTTL`) — typically once, in the root
 * layout. In the browser the provided registry also becomes the implicit one,
 * so {@link invalidateAtomKeys} called from non-component code reaches it.
 * Must be called during component initialisation.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   // src/routes/+layout.svelte
 *   import { makeAtomRegistry, provideAtomRegistry } from "@thomasfosterau/effect-svelte";
 *
 *   provideAtomRegistry(makeAtomRegistry({ defaultIdleTTL: 30_000 }));
 * </script>
 * ```
 */
export const provideAtomRegistry = (registry: AtomRegistry = makeAtomRegistry()): AtomRegistry => {
  setContextRegistry(registry);
  // In the browser it also becomes the implicit registry, so a mutation calling
  // `invalidateAtomKeys(keys)` outside any component reaches the readers of this
  // registry instead of silently invalidating an empty one. Never on the server,
  // where module state would leak between requests.
  if (isBrowser()) browserRegistry = Option.some(registry);
  return registry;
};

/**
 * The registry the atom hooks of this component read from: the nearest
 * {@link provideAtomRegistry}, else the implicit browser registry. Must be
 * called during component initialisation; throws on the server when no registry
 * was provided.
 */
export const getAtomRegistry = (): AtomRegistry => {
  try {
    return getContextRegistry() ?? defaultAtomRegistry();
  } catch (error) {
    // Outside component initialisation Svelte's `getContext` throws; fall back
    // to the implicit registry so non-component callers behave consistently.
    if (error instanceof AtomRegistryUnavailable) throw error;
    return defaultAtomRegistry();
  }
};

/** Options shared by the atom hooks. */
export interface UseAtomOptions {
  /** Read from this registry instead of the ambient one ({@link getAtomRegistry}). */
  readonly registry?: AtomRegistry | undefined;
}

/** The reactive view {@link useAtom} returns for a read-only atom. */
export interface UseAtomReturn<A> {
  /** The atom's current value, re-read whenever the registry notifies. */
  readonly current: A;
}

/** The reactive view {@link useAtom} returns for a writable atom. */
export interface UseWritableAtomReturn<R, W> extends UseAtomReturn<R> {
  /** Write to the atom (`registry.set`). */
  readonly set: (value: W) => void;
}

/**
 * Subscribe to `atom` in `registry`, notifying Svelte on a microtask.
 *
 * The notification is deferred, never delivered inline: `subscribe` mounts the
 * atom and `get` evaluates it, and both can notify *synchronously* — while
 * Svelte is still computing the derived that called them. `update()` bumps a
 * signal, so delivering it there throws `state_unsafe_mutation`. Deferring costs
 * nothing: a notification that lands during the read is already reflected in the
 * value the read returns, and one that lands later re-runs the getter next tick.
 */
const subscription = <A>(registry: AtomRegistry, atom: Atom.Atom<A>) => ({
  atom,
  subscribe: createSubscriber((update) => registry.subscribe(atom, () => queueMicrotask(update))),
});

/**
 * Read (and, for a writable atom, write) any atom reactively.
 *
 * `atom` is a **thunk**: when the atom's identity depends on `$state` (a family
 * keyed on an id, a query keyed on its request), the hook tracks those reads and
 * re-subscribes to the new atom.
 *
 * On the server there is no shared registry: unless one was provided, the atom
 * is evaluated once in a throwaway registry, which suits plain value atoms. Read
 * effectful atoms with {@link useAtomResult}, which skips the server entirely.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { Atom } from "effect/reactivity";
 *   import { useAtom } from "@thomasfosterau/effect-svelte";
 *
 *   const countAtom = Atom.make(0);
 *   const count = useAtom(() => countAtom);
 * </script>
 *
 * <button onclick={() => count.set(count.current + 1)}>{count.current}</button>
 * ```
 */
export function useAtom<R, W>(
  atom: () => Atom.Writable<R, W>,
  options?: UseAtomOptions,
): UseWritableAtomReturn<R, W>;
/** Read a read-only atom reactively; the returned handle has `current` but no `set`. */
export function useAtom<A>(atom: () => Atom.Atom<A>, options?: UseAtomOptions): UseAtomReturn<A>;
export function useAtom<R, W>(
  atom: () => Atom.Atom<R> | Atom.Writable<R, W>,
  options: UseAtomOptions = {},
): UseWritableAtomReturn<R, W> {
  const resolved = resolveRegistry(options);
  if (Option.isNone(resolved)) {
    // Server, no registry: evaluate once in a throwaway registry.
    return {
      get current() {
        const scratch = makeAtomRegistry();
        try {
          return scratch.get(atom());
        } finally {
          scratch.dispose();
        }
      },
      set: () => {
        throw new AtomRegistryUnavailable({
          message: "effect-svelte: useAtom(...).set has no registry to write to during SSR",
        });
      },
    };
  }
  const registry = resolved.value;
  const view = $derived(subscription(registry, atom()));

  return {
    get current() {
      view.subscribe();
      return registry.get(view.atom);
    },
    set: (value) => {
      const target = view.atom;
      if (!Atom.isWritable(target)) {
        throw new TypeError("effect-svelte: useAtom(...).set called on a read-only atom");
      }
      registry.set(target as Atom.Writable<R, W>, value);
    },
  };
}

/**
 * Read an atom's `AsyncResult` reactively — the common case for query atoms
 * (`AtomHttpApi`'s `query`, `Atom.make(effect)`).
 *
 * `atom` is a **thunk**, not a value: a query atom is identified by its request
 * (`AtomHttpApi` memoises on the whole `{ group, endpoint, params, query, … }`
 * key, structurally), so a view whose window or filter is `$state` names a
 * *different* atom as that state changes. Taking a thunk lets the hook track
 * those reads and re-subscribe, while a structurally-identical request keeps
 * resolving to the same atom — and therefore the same cached value.
 *
 * The result carries Effect's stale-while-revalidate semantics: a re-fetch (an
 * {@link invalidateAtomKeys}, a refresh) leaves the previous `Success` in place
 * with `waiting: true` rather than dropping back to `Initial`, so a template can
 * keep the list on screen and merely dim it.
 *
 * Safe during SSR: on the server it returns `AsyncResult.initial(true)` without
 * touching any registry, so a template renders its loading state and no request
 * whose value would be discarded is issued.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { AsyncResult, useAtomResult } from "@thomasfosterau/effect-svelte";
 *   import { commentsAtom } from "#lib/api/atoms";
 *
 *   let { postId } = $props();
 *   const comments = useAtomResult(() => commentsAtom(postId));
 * </script>
 *
 * {#if AsyncResult.isSuccess(comments.current)}
 *   <ul class:dimmed={comments.current.waiting}>
 *     {#each comments.current.value as comment (comment.id)}<li>{comment.body}</li>{/each}
 *   </ul>
 * {:else if AsyncResult.isFailure(comments.current)}
 *   <p>Couldn't load comments.</p>
 * {:else}
 *   <p>Loading…</p>
 * {/if}
 * ```
 */
export function useAtomResult<A, E>(
  atom: () => Atom.Atom<AsyncResult.AsyncResult<A, E>>,
  options: UseAtomOptions = {},
): UseAtomReturn<AsyncResult.AsyncResult<A, E>> {
  if (!isBrowser()) {
    return {
      get current() {
        return AsyncResult.initial<A, E>(true);
      },
    };
  }
  const registry = getOrThrow(resolveRegistry(options));
  // Re-derived when the thunk's own reactive dependencies change, so a new
  // request builds a new subscription against the new atom.
  const view = $derived(subscription(registry, atom()));

  return {
    get current() {
      // Subscribe *before* reading: `subscribe()` registers this read with
      // Svelte's tracker and mounts the atom in the registry, so the value
      // `get` returns is one the registry will keep up to date.
      view.subscribe();
      return registry.get(view.atom);
    },
  };
}

/** The explicit registry, else the ambient one, else `None` (server, nothing provided). */
const resolveRegistry = (options: UseAtomOptions): Option.Option<AtomRegistry> => {
  if (options.registry !== undefined) return Option.some(options.registry);
  try {
    return Option.some(getAtomRegistry());
  } catch (error) {
    if (error instanceof AtomRegistryUnavailable) return Option.none();
    throw error;
  }
};

const getOrThrow = (registry: Option.Option<AtomRegistry>): AtomRegistry =>
  Option.getOrElse(registry, () => defaultAtomRegistry());

/**
 * A registry's `Reactivity` service, as an atom.
 *
 * Built exactly as `Atom.runtime`'s own internal reactivity atom is —
 * `Reactivity.layer` through the runtime factory's memo map — so this resolves
 * to the *same* instance the query atoms register their invalidation handlers
 * against (`Atom.withReactivity`, which `AtomHttpApi`'s `query` applies when
 * given `reactivityKeys`). Building `Reactivity.layer` any other way would yield
 * a second, unrelated instance whose invalidations nothing is listening to.
 */
const reactivityAtom = Atom.keepAlive(
  Atom.make((get) =>
    Effect.contextWith((services: Context.Context<Scope.Scope>) =>
      Layer.buildWithMemoMap(
        Reactivity.layer,
        get(Atom.runtime.memoMap),
        Context.get(services, Scope.Scope),
      ),
    ).pipe(Effect.map(Context.get(Reactivity.Reactivity))),
  ),
);

/**
 * Invalidate reactivity keys, re-running every mounted atom registered against
 * them (`Atom.withReactivity(keys)`, or `AtomHttpApi` queries given
 * `reactivityKeys`).
 *
 * A mutation says *what changed* instead of each reader wiring its own re-fetch
 * trigger, and every reader of those keys — including ones in other components
 * — re-fetches. Invalidating keys nothing is mounted against is a no-op, so a
 * mutation may name its keys unconditionally. Callable from anywhere (event
 * handlers, mutation callbacks); pass `registry` when the readers use one given
 * to {@link provideAtomRegistry}.
 *
 * @example
 * ```ts
 * import { invalidateAtomKeys } from "@thomasfosterau/effect-svelte";
 *
 * await addComment(postId, body);
 * invalidateAtomKeys(["comments", postId]);
 * ```
 */
export const invalidateAtomKeys = (
  keys: ReadonlyArray<unknown> | Readonly<Record<string, ReadonlyArray<unknown>>>,
  registry: AtomRegistry = defaultAtomRegistry(),
): void => {
  // `reactivityAtom` builds a synchronous layer, so the registry always has it
  // resolved once read. Anything else is a bug in the wiring, not a case to
  // swallow.
  const result = registry.get(reactivityAtom);
  if (!AsyncResult.isSuccess(result)) {
    throw new AtomRegistryUnavailable({
      message: "effect-svelte: the registry's Reactivity atom has not resolved",
    });
  }
  result.value.invalidateUnsafe(keys);
};
