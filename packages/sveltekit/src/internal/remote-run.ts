/**
 * Run/settle helpers for the remote-function wrappers, factored out so they can
 * be unit-tested without importing `$app/server` (a SvelteKit virtual module
 * unavailable outside an app build). The `$app/server`-dependent resolvers live
 * in `remote-functions.ts`; this module only deals in `Exit`s.
 */

import type { InvalidField } from "@sveltejs/kit";
import { Cause, type Effect, Exit } from "effect";
import type { ErrorTranslator } from "../request-runtime.js";
import { SvelteKit } from "../kit.js";

/** The default translator: Kit control-flow errors through, anything else a 500. */
export const defaultTranslate: ErrorTranslator = SvelteKit.translate;

/**
 * Maps a remote *form* handler's failure into SvelteKit's field issues, given
 * the form's parsed `data` and the `issue` helper. It may call `invalid()` so a
 * structured/nested validation error drives field-level invalidation instead of
 * a generic failure. Receives the squashed handler failure.
 */
export type FormErrorMapper = (
  error: unknown,
  ctx: { readonly issue: InvalidField<any>; readonly data: unknown },
) => never;

/** Runs a remote handler's effect and settles it (value or thrown via translator). */
export type Runner = <A>(effect: Effect.Effect<A, unknown, any>) => Promise<A>;

/** Like {@link Runner}, but with the form's `issue` / `data` for error interop. */
export type FormRunner = <A>(
  effect: Effect.Effect<A, unknown, any>,
  ctx: { readonly issue: InvalidField<any>; readonly data: unknown },
) => Promise<A>;

/** Runners that execute a remote-function handler's Effect on a request runtime, as `runRemote` returns them. */
export interface RunHelpers {
  readonly run: Runner;
  readonly runForm: FormRunner;
}

/** How to obtain an `Exit` for the current request, plus optional teardown. */
export type ExitResolver = () => {
  readonly runExit: <A>(effect: Effect.Effect<A, unknown, any>) => Promise<Exit.Exit<A, unknown>>;
  readonly dispose?: () => void;
};

/** Build the `run` / `runForm` helpers from an exit resolver and a translator. */
export const makeRunHelpers = (
  resolve: ExitResolver,
  translate: ErrorTranslator,
  formError?: FormErrorMapper,
): RunHelpers => {
  const run: Runner = (effect) => {
    const { runExit, dispose } = resolve();
    return runExit(effect).then((exit) => {
      try {
        return Exit.isSuccess(exit) ? exit.value : translate(exit.cause);
      } finally {
        dispose?.();
      }
    });
  };
  const runForm: FormRunner = (effect, ctx) => {
    const { runExit, dispose } = resolve();
    return runExit(effect).then((exit) => {
      try {
        if (Exit.isSuccess(exit)) return exit.value;
        return formError ? formError(Cause.squash(exit.cause), ctx) : translate(exit.cause);
      } finally {
        dispose?.();
      }
    });
  };
  return { run, runForm };
};
