/**
 * Effect bridge for SvelteKit's native form actions
 * ([`$app/forms`](https://svelte.dev/docs/kit/$app-forms)) — the `Forms`
 * namespace of `@thomasfosterau/effect-sveltekit/client`.
 *
 * This complements `Remote.submitForm` (which covers *remote* forms): here the
 * progressive-enhancement `use:enhance` flow for page `actions` is expressed
 * with Effects, and `applyAction` / `deserialize` are wrapped so a hand-rolled
 * `fetch` submission can be finished off inside an Effect pipeline.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { enhance } from '$app/forms';
 *   import { Forms } from '@thomasfosterau/effect-sveltekit/client';
 *   import { Effect } from 'effect';
 *
 *   const submit = Forms.enhance({
 *     onSubmit: () => Effect.sync(() => { saving = true; }),
 *     onResult: ({ result, update }) =>
 *       Effect.gen(function* () {
 *         yield* Effect.promise(() => update());
 *         saving = false;
 *       }),
 *   });
 * </script>
 *
 * <form method="POST" use:enhance={submit}>...</form>
 * ```
 */

import { applyAction as kitApplyAction, deserialize as kitDeserialize } from "$app/forms";
import type { ActionResult } from "@sveltejs/kit";
import { Effect } from "effect";
import { makeSubmitFunction } from "./internal/enhance.js";

export type {
  EnhanceHandlers,
  EnhanceOptions,
  EnhanceRuntime,
  SubmitInput,
  ResultOptions,
} from "./internal/enhance.js";

/**
 * Build a `SubmitFunction` for `use:enhance` from Effect-based handlers.
 *
 * `onSubmit` runs before the request (call `input.cancel()` to abort);
 * `onResult` runs on the response with SvelteKit's `update()`. Omit `onResult`
 * to keep SvelteKit's default behaviour. Pass `{ runtime }` when the handlers
 * require application services.
 */
export const enhance = makeSubmitFunction;

/**
 * Apply an `ActionResult` to the page (updating `page.form` / `page.status`,
 * resetting the form, etc.) as an Effect. Wraps `$app/forms`' `applyAction`.
 */
export const applyAction = <
  Success extends Record<string, unknown> | undefined = Record<string, unknown>,
  Failure extends Record<string, unknown> | undefined = Record<string, unknown>,
>(
  result: ActionResult<Success, Failure>,
): Effect.Effect<void> => Effect.promise(() => kitApplyAction(result));

/**
 * Deserialize a raw form-action response body into an `ActionResult`, as an
 * Effect. Wraps `$app/forms`' `deserialize`; a malformed body fails the effect.
 */
export const deserialize = <
  Success extends Record<string, unknown> | undefined = Record<string, unknown>,
  Failure extends Record<string, unknown> | undefined = Record<string, unknown>,
>(
  result: string,
): Effect.Effect<ActionResult<Success, Failure>, unknown> =>
  Effect.try({
    try: () => kitDeserialize<Success, Failure>(result),
    catch: (error) => error,
  });
