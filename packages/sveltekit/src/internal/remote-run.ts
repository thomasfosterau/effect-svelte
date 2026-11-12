/**
 * Run/settle helpers for the remote-function wrappers, factored out so they can
 * be unit-tested without importing `$app/server` (a SvelteKit virtual module
 * unavailable outside an app build). The `$app/server`-dependent resolvers live
 * in `remote-functions.ts`; this module only deals in `Exit`s.
 */

import type { RemoteFormInvalidField as InvalidField } from "$app/server";
import * as Cause from "effect/Cause";
import type * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type { ErrorTranslator } from "../request-runtime.js";
import { SvelteKit } from "../kit.js";

/** The default translator: Kit control-flow errors through, anything else a 500. */
export const defaultTranslate: ErrorTranslator = SvelteKit.translate;

/**
 * Maps a remote *form* handler's failure into SvelteKit's field issues, given
 * the form's parsed `data` and the `issue` helper. It may call `invalid()` so a
 * structured/nested validation error drives field-level invalidation instead of
 * a generic failure. Receives the squashed handler failure: whatever
 * `Cause.squash` makes of the failed `Cause` (the typed failure, a defect or an
 * interruption error), so it is `unknown` until the mapper narrows it.
 */
export type FormErrorMapper = (
  error: ReturnType<typeof Cause.squash>,
  ctx: { readonly issue: InvalidField<any>; readonly data: unknown },
) => never;

/**
 * Runs a remote handler's effect, which may require the services `Env` of the
 * request runtime, and settles it (value or thrown via translator).
 */
export type Runner<Env = never> = <A>(effect: Effect.Effect<A, unknown, Env>) => Promise<A>;

/** Like {@link Runner}, but with the form's `issue` / `data` for error interop. */
export type FormRunner<Env = never> = <A>(
  effect: Effect.Effect<A, unknown, Env>,
  ctx: { readonly issue: InvalidField<any>; readonly data: unknown },
) => Promise<A>;

/**
 * Runners that execute a remote-function handler's Effect on a request runtime
 * that provides the services `Env`, as `runRemote` returns them.
 */
export interface RunHelpers<Env = never> {
  readonly run: Runner<Env>;
  readonly runForm: FormRunner<Env>;
}

/**
 * How to obtain an `Exit` for the current request, on a runtime that provides
 * the services `Env`, plus optional teardown.
 */
export type ExitResolver<Env = never> = () => {
  readonly runExit: <A>(effect: Effect.Effect<A, unknown, Env>) => Promise<Exit.Exit<A, unknown>>;
  readonly dispose?: () => void;
};

/**
 * Settle an exit (return its value, or throw via the translator) and then run
 * the optional teardown, whether settling returned or threw; a throw becomes
 * the returned promise's rejection.
 */
const settleThenDispose = <A>(settle: () => A, dispose?: () => void): Promise<A> =>
  new Promise<A>((resolve) => resolve(settle())).finally(() => dispose?.());

/** Build the `run` / `runForm` helpers from an exit resolver and a translator. */
export const makeRunHelpers = <Env>(
  resolve: ExitResolver<Env>,
  translate: ErrorTranslator,
  formError?: FormErrorMapper,
): RunHelpers<Env> => {
  const run: Runner<Env> = (effect) => {
    const { runExit, dispose } = resolve();
    return runExit(effect).then((exit) =>
      settleThenDispose(() => (Exit.isSuccess(exit) ? exit.value : translate(exit.cause)), dispose),
    );
  };
  const runForm: FormRunner<Env> = (effect, ctx) => {
    const { runExit, dispose } = resolve();
    return runExit(effect).then((exit) =>
      settleThenDispose(() => {
        if (Exit.isSuccess(exit)) return exit.value;
        return formError ? formError(Cause.squash(exit.cause), ctx) : translate(exit.cause);
      }, dispose),
    );
  };
  return { run, runForm };
};
