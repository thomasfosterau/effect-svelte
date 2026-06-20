/**
 * Svelte namespace containing Effect-Svelte interoperability primitives.
 * Provides reactive hooks and utilities for integrating Effect-TS with Svelte 5 runes.
 */

// Layer 0: Runtime Context
export { provideRuntime, getRuntime } from "./context.svelte.js";
export type { RuntimeLike } from "./context.svelte.js";
export { SvelteRuntime, defaultSvelteRuntime } from "./runtime.js";

// Layer 1: Scope Primitive
export { useScope, useScopeCallback } from "./scope.svelte.js";

// Layer 2: Core Runners
export { useEffect, type UseEffectOptions, type UseEffectReturn } from "./effect.svelte.js";
export { useStream, type UseStreamReturn } from "./stream.svelte.js";

// Layer 3: Convenience Hooks
export { derived, type DerivedReturn } from "./derived.svelte.js";
export { useQuery, type UseQueryReturn } from "./query.svelte.js";
export {
  useSubscriptionRef,
  usePubSub,
  type UseSubscriptionRefReturn,
  type UsePubSubReturn,
} from "./subscription.svelte.js";

// Layer 4: Effect Reactivity Integration (effect/unstable/reactivity)
export {
  reactiveQuery,
  reactiveStream,
  reactiveMutation,
  useInvalidateKeys,
  type ReactiveQueryReturn,
  type ReactiveStreamReturn,
  type ReactiveMutationReturn,
} from "./reactivity.svelte.js";

// Svelte-to-Effect Direction
export { SignalEmitter } from "./emitter.js";
export { streamFromStore } from "./store.js";

// Effect-to-Svelte Store Direction
export { subscriptionRefToStore, streamToStore } from "./store.js";

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
export * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
