import { Reactivity } from "@effect/experimental";
import { Layer } from "effect";
import { SvelteRuntime } from "@thomasfosterau/effect-svelte";
import { TodoRepository } from "./todo-repository";

/**
 * The application runtime: the base Svelte runtime extended with
 *
 * - `TodoRepository` — the localStorage-backed todo store, and
 * - `Reactivity` — the @effect/experimental service that powers
 *   `reactiveQuery` / `reactiveMutation` / `useInvalidateKeys`.
 *
 * It is provided to the component tree once, in `App.svelte`, via
 * `provideRuntime(appRuntime)`.
 */
export const appRuntime = SvelteRuntime.extend(
  Layer.merge(TodoRepository.Default, Reactivity.layer),
);
