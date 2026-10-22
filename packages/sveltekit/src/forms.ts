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
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import { makeSubmitFunction } from "./internal/enhance.js";

export type {
  EnhanceHandlers,
  EnhanceOptions,
  EnhanceOptionsArgs,
  EnhanceRuntime,
  SubmitInput,
  ResultOptions,
} from "./internal/enhance.js";

/**
 * Build a `SubmitFunction` for `use:enhance` from Effect-based handlers.
 *
 * `onSubmit` runs before the request (call `input.cancel()` to abort);
 * `onResult` runs on the response with SvelteKit's `update()`. Omit `onResult`
 * to keep SvelteKit's default behaviour. When the handlers (or `onError`)
 * require application services, pass `{ runtime }` (a `Context` or
 * `ManagedRuntime` providing them): it is then required, and a call without it
 * does not type-check. Each handler may require different services; the runtime
 * must provide all of them. A missing runtime is reported on the call, and one
 * that lacks a service on the runtime, never on a handler; the message may at
 * first name only the services of the handlers TypeScript types first (such as
 * an `onError` passed by name), and the rest once the runtime provides those.
 * Handlers that require no services run on the default runtime, and the options
 * may be omitted; an effect typed as requiring `any` or `unknown` is treated as
 * requiring no services, so no runtime is demanded. A function that wraps
 * `enhance` for handlers requiring any `R` forwards its options as
 * `...options: EnhanceOptionsArgs<R>` (or takes a required
 * `{ runtime: EnhanceRuntime<R> }`): an `EnhanceOptions<R>`, whose runtime is
 * optional, does not type-check there.
 *
 * Either handler may fail. Add an `onError` handler to handle the error
 * (typed as the union of the handlers' error types when written after them;
 * `unknown` when written before a handler with unannotated parameters): a
 * failed `onSubmit` also cancels the submission, and a failed `onResult` does
 * not fall back to SvelteKit's default behaviour. Without `onError`, or for a
 * defect or interruption, the promise SvelteKit awaits rejects (with the error
 * itself for a failure), which SvelteKit leaves unhandled.
 *
 * @example
 * ```ts
 * const submit = Forms.enhance({
 *   onResult: ({ result }) => Forms.applyAction(result),
 *   // error: ApplyActionError
 *   onError: (error) => Effect.logWarning("applyAction failed", error.cause),
 * });
 * ```
 */
export const enhance = makeSubmitFunction;

/**
 * {@link applyAction} rejected or threw. `cause` is SvelteKit's original
 * reason, unchanged.
 *
 * SvelteKit 3 throws when `applyAction` is called during server rendering, and
 * follows a `redirect` result with a client-side navigation that rejects if it
 * fails: for example, a `location` that cannot be parsed even relative to the
 * page's base URL, or a `beforeNavigate` / `onNavigate` callback that throws. Recover with
 * `Effect.catchTag("ApplyActionError", ...)`.
 */
export class ApplyActionError extends Schema.TaggedError<ApplyActionError>()("ApplyActionError", {
  /** The rejection reason, or the value thrown, as SvelteKit produced it. */
  cause: Schema.Defect(),
}) {}

/**
 * Apply an `ActionResult` to the page (updating `page.form` / `page.status`,
 * resetting the form, etc.) as an Effect. Wraps `$app/forms`' `applyAction`.
 *
 * Fails with an {@link ApplyActionError} if SvelteKit rejects or throws: for
 * example, when the navigation that follows a `redirect` result fails, or when
 * called during server rendering.
 *
 * {@link enhance}'s `onResult` can return it directly; its `onError` handler
 * then receives the `ApplyActionError`. Without `onError`, the error rejects
 * the promise SvelteKit awaits.
 *
 * @example
 * ```ts
 * const submit = Forms.enhance({
 *   onResult: ({ result }) => Forms.applyAction(result),
 *   onError: (error) => Effect.logWarning("applyAction failed", error.cause),
 * });
 * ```
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
