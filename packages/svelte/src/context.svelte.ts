import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { createContext } from "svelte";
import { defaultSvelteRuntime } from "./runtime.js";
import type { RuntimeLike } from "./internal/run.js";

/**
 * Type-safe context for Effect runtime management.
 * Uses Svelte 5's createContext API for better type safety and developer experience.
 *
 * The context accepts either a plain services `Context.Context` (e.g. `Context.empty()`)
 * or a `ManagedRuntime` (e.g. `SvelteRuntime.defaultRuntime` / `SvelteRuntime.extend(...)`).
 * Users must ensure their runtime provides all required services for the effects they run.
 */
const [getRuntime, provideRuntimeInternal] = createContext<RuntimeLike<never>>();

/**
 * Thrown by {@link getRuntime} and `RuntimeContext.get` when no parent
 * component provided a runtime. It is thrown synchronously (these are Svelte
 * context lookups, not Effects), and its `message` says which context was
 * missing.
 */
class RuntimeNotFoundError extends Schema.TaggedError<RuntimeNotFoundError>()(
  "RuntimeNotFoundError",
  { message: Schema.String },
) {}

/**
 * Retrieves the Effect runtime from Svelte context.
 *
 * @returns The runtime provided via provideRuntime
 * @throws {RuntimeNotFoundError} if called outside of a component with a provided runtime
 */
function getRuntimeContext(): RuntimeLike<never> {
  const runtime = getRuntime();
  if (runtime === undefined) {
    throw new RuntimeNotFoundError({
      message:
        "effect-svelte: No Effect runtime found in context. " +
        "Make sure you have called provideRuntime() in a parent component.",
    });
  }
  return runtime;
}

/**
 * Provides an Effect runtime to the Svelte context tree.
 * This should be called at the root of your component tree, typically in your root layout.
 *
 * The default runtime (SvelteRuntime.defaultRuntime) is recommended for most applications.
 * For applications requiring custom services, extend the runtime using SvelteRuntime.extend().
 *
 * @param runtime - The Effect runtime to provide. Defaults to SvelteRuntime.defaultRuntime
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { provideRuntime, SvelteRuntime } from '@thomasfosterau/effect-svelte';
 *
 *   // Use default runtime
 *   provideRuntime();
 *
 *   // Or provide a custom runtime
 *   const customRuntime = SvelteRuntime.extend(myCustomLayer);
 *   provideRuntime(customRuntime);
 * </script>
 * ```
 */
function provideRuntime<R = never>(runtime?: RuntimeLike<R>): void {
  provideRuntimeInternal(runtime ?? defaultSvelteRuntime);
}

/**
 * A dedicated, type-safe runtime context.
 *
 * Unlike the shared default context ({@link provideRuntime} / {@link getRuntime},
 * which is untyped — `RuntimeLike<never>`), each call to `createRuntimeContext`
 * mints its *own* context instance carrying a fully-typed `RuntimeLike<R>`. A
 * library whose whole point is a service-typed runtime (e.g.
 * `ManagedRuntime<ClientView, never>`) can therefore expose its own context
 * without colliding with the default context or with other libraries, and
 * `get()` returns the precise `RuntimeLike<R>` rather than `RuntimeLike<never>`.
 */
interface RuntimeContext<R> {
  /**
   * Provide the runtime to the component subtree. Like `setContext`, this must
   * be called during component initialisation.
   */
  readonly provide: (runtime: RuntimeLike<R>) => void;

  /**
   * Retrieve the runtime. Must be called during component initialisation.
   * Throws an actionable error when no ancestor called `provide`.
   */
  readonly get: () => RuntimeLike<R>;
}

/**
 * Create a typed runtime context, built on Svelte's
 * [`createContext`](https://svelte.dev/docs/svelte/svelte#createContext) (one
 * context instance per call).
 *
 * @param name - an optional label used in the "runtime not provided" error, to
 *   help downstream users find the missing `provide` call.
 *
 * @example
 * ```ts
 * // library.ts — a library exposing a service-typed runtime
 * import { createRuntimeContext } from '@thomasfosterau/effect-svelte';
 * import type { ManagedRuntime } from 'effect';
 * import type { ClientView } from './client.js';
 *
 * export const ClientContext =
 *   createRuntimeContext<ClientView>('@legation/svelte client');
 * ```
 * ```svelte
 * <script lang="ts">
 *   // Root.svelte
 *   import { ClientContext } from './library.js';
 *   ClientContext.provide(myClientRuntime);
 * </script>
 * ```
 */
function createRuntimeContext<R>(name?: string): RuntimeContext<R> {
  const [get, set] = createContext<RuntimeLike<R>>();
  const label = name === undefined ? "this runtime context" : `the "${name}" runtime context`;

  return {
    provide(runtime) {
      set(runtime);
    },
    get() {
      return Result.getOrThrowWith(
        Result.try(get),
        () =>
          new RuntimeNotFoundError({
            message:
              `effect-svelte: No Effect runtime found for ${label}. ` +
              "Call its `provide(runtime)` in a parent component during initialisation.",
          }),
      );
    },
  };
}

export {
  createRuntimeContext,
  getRuntimeContext as getRuntime,
  provideRuntime,
  RuntimeNotFoundError,
};
export type { RuntimeContext, RuntimeLike };
