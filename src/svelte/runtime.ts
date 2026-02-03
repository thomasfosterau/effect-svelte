import { Layer, ManagedRuntime } from "effect";

/**
 * Custom runtime for Svelte helpers.
 * 
 * This runtime is designed specifically for Svelte components and provides:
 * - Type-safe environment tracking
 * - Optimized for client-side execution
 * - Support for reactive primitives
 * 
 * Users can extend this runtime with additional services as needed.
 * 
 * @example
 * ```ts
 * import { SvelteRuntime } from '@thomasfosterau/effect-svelte/svelte';
 * import { provideRuntime } from '@thomasfosterau/effect-svelte';
 * import { Layer } from 'effect';
 * import { MyService } from './services';
 * 
 * // Extend the base runtime with custom services
 * const customRuntime = SvelteRuntime.extend(Layer.succeed(MyService, myServiceImpl));
 * 
 * // Provide to Svelte context
 * provideRuntime(customRuntime);
 * ```
 */
export class SvelteRuntime {
  /**
   * The base Svelte runtime with minimal services.
   * This is suitable for most client-side Svelte applications.
   */
  private static readonly baseLayer = Layer.empty;

  /**
   * The default managed runtime instance.
   * This provides the core runtime without additional services.
   */
  static readonly defaultRuntime = ManagedRuntime.make(this.baseLayer);

  /**
   * Creates a custom runtime by extending the base Svelte runtime with additional layers.
   * 
   * @param layer - The layer containing additional services to provide
   * @returns A new managed runtime with the extended services
   * 
   * @example
   * ```ts
   * import { SvelteRuntime } from '@thomasfosterau/effect-svelte/svelte';
   * import { Layer, Context } from 'effect';
   * 
   * // Define a custom service
   * class Analytics extends Context.Tag("Analytics")<Analytics, {
   *   track: (event: string) => Effect.Effect<void>
   * }>() {}
   * 
   * // Create an implementation
   * const analyticsLayer = Layer.succeed(Analytics, {
   *   track: (event) => Effect.sync(() => console.log(event))
   * });
   * 
   * // Extend the runtime
   * const runtime = SvelteRuntime.extend(analyticsLayer);
   * ```
   */
  static extend<R>(layer: Layer.Layer<R>): ManagedRuntime.ManagedRuntime<R, never> {
    return ManagedRuntime.make(Layer.merge(this.baseLayer, layer));
  }

  /**
   * Creates a custom runtime from a layer, replacing the base layer entirely.
   * Use this when you want full control over the runtime environment.
   * 
   * @param layer - The complete layer to use for the runtime
   * @returns A new managed runtime with only the provided services
   */
  static make<R>(layer: Layer.Layer<R>): ManagedRuntime.ManagedRuntime<R, never> {
    return ManagedRuntime.make(layer);
  }
}

/**
 * Default runtime instance for convenience.
 * This is the recommended runtime for most Svelte applications.
 */
export const defaultSvelteRuntime = SvelteRuntime.defaultRuntime;
