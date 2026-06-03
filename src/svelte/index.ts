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
export { derived } from "./derived.svelte.js";
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
} from "./reactivity.svelte.js";

// Svelte-to-Effect Direction
export { SignalEmitter } from "./emitter.js";

// Types and Utilities
export type { AsyncResult } from "./types.js";
export { isInitial, isPending, isSuccess, isFailure, match } from "./utils.js";
