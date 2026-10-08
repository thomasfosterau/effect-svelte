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
import type { ActionResult } from "$app/forms";
import { Data, Effect } from "effect";
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
 * {@link applyAction} rejected or threw. `cause` is SvelteKit's original
 * reason, unchanged.
 *
 * SvelteKit 3 throws when `applyAction` is called during server rendering, and
 * follows a `redirect` result with a client-side navigation that rejects if it
 * fails: for example, a `location` that is not a valid URL, or a
 * `beforeNavigate` / `onNavigate` callback that throws. Recover with
 * `Effect.catchTag("ApplyActionError", ...)`.
 */
export class ApplyActionError extends Data.TaggedError("ApplyActionError")<{
  /** The rejection reason, or the value thrown, as SvelteKit produced it. */
  readonly cause: unknown;
}> {}

/**
 * Apply an `ActionResult` to the page (updating `page.form` / `page.status`,
 * resetting the form, etc.) as an Effect. Wraps `$app/forms`' `applyAction`.
 *
 * Fails with an {@link ApplyActionError} if SvelteKit rejects or throws: for
 * example, when the navigation that follows a `redirect` result fails, or when
 * called during server rendering.
 */
export const applyAction = <
  Success extends Record<string, unknown> | undefined = Record<string, unknown>,
  Failure extends Record<string, unknown> | undefined = Record<string, unknown>,
>(
  result: ActionResult<Success, Failure>,
): Effect.Effect<void, ApplyActionError> =>
  Effect.tryPromise({
    try: () => kitApplyAction(result),
    catch: (cause) => new ApplyActionError({ cause }),
  });

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
