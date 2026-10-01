/**
 * Effect v4 bindings for Svelte 5 runes: runtime context, hooks that expose an
 * `AsyncResult` via `.current`, atom bindings, and Svelte store interop.
 */

// Layer 0: Runtime Context
export { provideRuntime, getRuntime, createRuntimeContext } from "./context.svelte.js";
export type { RuntimeLike, RuntimeContext } from "./context.svelte.js";
export { SvelteRuntime, defaultSvelteRuntime } from "./runtime.js";

// Layer 1: Scope Primitive
export { useScope, useScopeCallback } from "./scope.svelte.js";

// Layer 2: Core Runners
export { useEffect, type UseEffectOptions, type UseEffectReturn } from "./effect.svelte.js";
export { useStream, type UseStreamOptions, type UseStreamReturn } from "./stream.svelte.js";
export {
  useLiveStream,
  type UseLiveStreamOptions,
  type UseLiveStreamReturn,
} from "./live-stream.svelte.js";

// Layer 3: Convenience Hooks
export { useDerived, type DerivedReturn, type UseDerivedOptions } from "./derived.svelte.js";
export { useQuery, type UseQueryOptions, type UseQueryReturn } from "./query.svelte.js";
export {
  useMutation,
  type UseMutationOptions,
  type UseMutationReturn,
  type MutationCallbacks,
} from "./mutation.svelte.js";
export {
  useQueryPromise,
  type UseQueryPromiseOptions,
  type UseQueryPromiseReturn,
} from "./await.svelte.js";
export {
  useSubscriptionRef,
  usePubSub,
  type UseSubscriptionRefOptions,
  type UsePubSubOptions,
  type UseSubscriptionRefReturn,
  type UsePubSubReturn,
} from "./subscription.svelte.js";
export {
  useWritableRef,
  type UseWritableRefOptions,
  type UseWritableRefReturn,
} from "./writable-ref.svelte.js";

// Layer 4: Effect Reactivity Integration (effect/reactivity)
export {
  reactiveQuery,
  reactiveStream,
  reactiveMutation,
  useInvalidateKeys,
  type ReactiveOptions,
  type ReactiveQueryReturn,
  type ReactiveStreamReturn,
  type ReactiveMutationReturn,
} from "./reactivity.svelte.js";

// Layer 5: Atom binding (effect/reactivity atoms) and search
export {
  useAtom,
  useAtomResult,
  invalidateAtomKeys,
  makeAtomRegistry,
  provideAtomRegistry,
  getAtomRegistry,
  AtomRegistryUnavailable,
  type AtomRegistry,
  type MakeAtomRegistryOptions,
  type UseAtomOptions,
  type UseAtomReturn,
  type UseWritableAtomReturn,
} from "./atom.svelte.js";
export {
  useDebouncedSearch,
  type DebouncedSearchState,
  type UseDebouncedSearchOptions,
  type UseDebouncedSearchReturn,
} from "./debounced-search.svelte.js";

// Svelte-to-Effect Direction
export { SignalEmitter } from "./emitter.js";

/**
 * Svelte [store](https://svelte.dev/docs/svelte/stores) interop, both
 * directions. `Store.toStream` turns a Svelte readable store into an Effect
 * `Stream`; the `Store.from*` helpers (`fromStream`, `fromSubscriptionRef`,
 * `fromPubSub`, `fromQueue`, `fromRef`) expose an Effect source as a Svelte
 * readable store.
 *
 * @example
 * ```ts
 * import { Store } from '@thomasfosterau/effect-svelte';
 *
 * const stream = Store.toStream(someStore);
 * const store = Store.fromSubscriptionRef(ref, runtime);
 * ```
 */
export * as Store from "./Store.js";

/**
 * The native Effect `AsyncResult` type and its combinators
 * (`AsyncResult.match`, `AsyncResult.isSuccess`, `AsyncResult.getOrElse`, ...).
 *
 * Every result-producing hook in this package exposes an
 * `AsyncResult.AsyncResult<A, E>` via its `current` property. Re-exported here
 * so it can be imported alongside the hooks, and so the package stays aligned
 * with the wider Effect ecosystem (the same type the official atom bindings
 * use).
 */
export * as AsyncResult from "effect/reactivity/AsyncResult";
