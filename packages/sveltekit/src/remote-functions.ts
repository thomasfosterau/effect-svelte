// NOTE: This module builds the `query` / `form` / `command` / `prerender`
// *factories* that consumers call inside their own `*.remote.ts` files — it is
// NOT itself a SvelteKit remote module, and its exports (e.g. `RemoteFunction`)
// are deliberately not remote functions. Its filename must therefore never match
// SvelteKit's remote-module matcher `/[/.]remote(\.[^/]+)+$/`
// (kit `src/exports/vite/utils.js`), or kit's build-time validation will reject
// the built file with "all exports from this file must be remote functions".
// That is why this is `remote-functions.ts` and never `remote.server.ts` /
// `*.remote.ts`. See `tests/remote-module-naming.test.ts` for the guard.
import * as AppServer from "$app/server";
import type {
  RemoteCommand,
  RemoteForm,
  RemoteFormInput,
  RemotePrerenderFunction,
  RemoteQueryFunction,
  RemoteFormInvalidField as InvalidField,
} from "$app/server";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import * as HttpClient from "effect/http/HttpClient";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { SvelteKitRuntime, SvelteKitRequestEvent } from "./runtime.js";
import {
  isBareHandler as isBareHandlerValue,
  toStandardValidator,
} from "./internal/remote-validators.js";
import {
  defaultTranslate,
  makeRunHelpers,
  type FormErrorMapper,
  type RunHelpers,
  type Runner,
} from "./internal/remote-run.js";
import type { ErrorTranslator, RequestRuntimeProvider } from "./request-runtime.js";

export type { FormErrorMapper } from "./internal/remote-run.js";

type SvelteKitEffectEnv = HttpClient.HttpClient | SvelteKitRequestEvent;

/** The default helpers: a fresh SvelteKit per-request runtime, passthrough translation. */
const defaultHelpers: RunHelpers = makeRunHelpers(() => {
  const event = AppServer.getRequestEvent();
  return { runExit: (effect) => SvelteKitRuntime.forRequest(event).runPromiseExit(effect) };
}, defaultTranslate);

/** Build helpers from a {@link RequestRuntimeProvider}, translator, and form-error mapper. */
const helpersFromProvider = (
  provider: RequestRuntimeProvider<any, any>,
  translate: ErrorTranslator,
  formError?: FormErrorMapper,
): RunHelpers =>
  makeRunHelpers(
    () => {
      const event = AppServer.getRequestEvent();
      return {
        runExit: (effect) => provider.run(event).runPromiseExit(effect),
        dispose: () => provider.disposeAfterResponse?.(event),
      };
    },
    translate,
    formError,
  );

function unavailable(name: string): never {
  throw new Error(
    `${name} is not available in the installed SvelteKit version. Update @sveltejs/kit to use this API.`,
  );
}

/** Any validator argument the remote helpers accept in the handler-with-validation position. */
type Validator = "unchecked" | StandardSchemaV1 | Schema.Top;

type EffectHandler<In, Out, Env> = (arg: In) => Effect.Effect<Out, unknown, Env>;
type EffectVoidHandler<Out, Env> = () => Effect.Effect<Out, unknown, Env>;

/** `inputs` / `dynamic` options of a remote `prerender`, for input type `In`. */
interface PrerenderOptions<In> {
  inputs?: () => Promise<In[]> | In[];
  dynamic?: boolean;
}

/** True when the argument is the no-validation handler overload (typed narrowing). */
const isBareHandler = <Out, Env>(
  value: Validator | EffectVoidHandler<Out, Env>,
): value is EffectVoidHandler<Out, Env> => isBareHandlerValue(value);

/**
 * Normalise a validator for kit's `$app/server` helpers, typed as the
 * `"unchecked"` overload so one call site serves every validator kind.
 */
// SAFETY: `toStandardValidator` returns either the `"unchecked"` marker or a
// Standard Schema (a bare Effect `Schema` is wrapped); kit accepts both at
// runtime, and the `"unchecked"` typing only selects the overload whose handler
// input is the generic `In` the public overloads already fixed.
const toKitValidator = (validator: Validator): "unchecked" =>
  toStandardValidator(validator) as "unchecked";

/** The public shape of the `query` helper, parameterised by its handler env. */
export interface QueryFn<Env> {
  <Output>(fn: () => Effect.Effect<Output, unknown, Env>): RemoteQueryFunction<void, Output>;
  <Input, Output>(
    validate: "unchecked",
    fn: (arg: Input) => Effect.Effect<Output, unknown, Env>,
  ): RemoteQueryFunction<Input, Output>;
  <Sch extends StandardSchemaV1, Output>(
    schema: Sch,
    fn: (arg: StandardSchemaV1.InferOutput<Sch>) => Effect.Effect<Output, unknown, Env>,
  ): RemoteQueryFunction<StandardSchemaV1.InferInput<Sch>, Output>;
  <S extends Schema.Top, Output>(
    schema: S,
    fn: (arg: S["Type"]) => Effect.Effect<Output, unknown, Env>,
  ): RemoteQueryFunction<S["Encoded"], Output>;
}

const makeQuery = <Env>(run: Runner): QueryFn<Env> => {
  const impl = <In, Out>(
    arg1: Validator | EffectVoidHandler<Out, Env>,
    arg2?: EffectHandler<In, Out, Env>,
  ) => {
    if (isBareHandler<Out, Env>(arg1)) {
      const handler = arg1;
      return AppServer.query(() => run(handler()));
    }

    if (!arg2) {
      throw new Error("query requires a handler function when a schema is provided");
    }

    return AppServer.query(toKitValidator(arg1), (arg: In) => run(arg2(arg)));
  };
  // SAFETY: `impl` dispatches on the argument kind exactly as the `QueryFn`
  // overloads distinguish them (bare handler, or validator then handler), and
  // returns kit's `RemoteQueryFunction` for that overload.
  return impl as QueryFn<Env>;
};

/** The public shape of `query.batch`, parameterised by its handler env. */
export interface QueryBatchFn<Env> {
  <Input, Output>(
    validate: "unchecked",
    fn: (args: Input[]) => Effect.Effect<(arg: Input, idx: number) => Output, unknown, Env>,
  ): RemoteQueryFunction<Input, Output>;
  <Sch extends StandardSchemaV1, Output>(
    schema: Sch,
    fn: (
      args: StandardSchemaV1.InferOutput<Sch>[],
    ) => Effect.Effect<
      (arg: StandardSchemaV1.InferOutput<Sch>, idx: number) => Output,
      unknown,
      Env
    >,
  ): RemoteQueryFunction<StandardSchemaV1.InferInput<Sch>, Output>;
  <S extends Schema.Top, Output>(
    schema: S,
    fn: (args: S["Type"][]) => Effect.Effect<(arg: S["Type"], idx: number) => Output, unknown, Env>,
  ): RemoteQueryFunction<S["Encoded"], Output>;
}

const makeQueryBatch = <Env>(run: Runner): QueryBatchFn<Env> => {
  const impl = <In, Out>(
    validate: Validator,
    fn: (args: In[]) => Effect.Effect<(arg: In, idx: number) => Out, unknown, Env>,
  ) => AppServer.query.batch(toKitValidator(validate), (args: In[]) => run(fn(args)));
  // SAFETY: every `QueryBatchFn` overload is (validator, batch handler), which
  // `impl` forwards to kit's `query.batch` unchanged.
  return impl as QueryBatchFn<Env>;
};

/** `$app/server`, with `requested` typed as a generic passthrough. */
type AppServerWithRequested = Omit<typeof AppServer, "requested"> & {
  readonly requested?: <Result>(...args: unknown[]) => Result;
};

// SAFETY: widens `requested` to optional (older kits may lack it, so the call
// site checks before calling) and erases its overloads, which `requested` below
// re-exposes with the caller-chosen `Result`.
const appServerCompat = AppServer as AppServerWithRequested;

function getQueryLive(): typeof AppServer.query.live {
  const live: typeof AppServer.query.live | undefined = AppServer.query.live;

  if (!Predicate.isFunction(live)) {
    unavailable("query.live");
  }

  return live;
}

function getRequested(): <Result>(...args: unknown[]) => Result {
  const requestedFn = appServerCompat.requested;

  if (!Predicate.isFunction(requestedFn)) {
    unavailable("requested");
  }

  return requestedFn;
}

/** The public shape of `query.live`, parameterised by its handler env. */
export interface QueryLiveFn<Env> {
  <Input, Output>(
    validate: "unchecked",
    fn: (arg: Input) => Effect.Effect<AsyncIterable<Output>, unknown, Env>,
  ): RemoteQueryFunction<Input, Output>;
  <Sch extends StandardSchemaV1, Output>(
    schema: Sch,
    fn: (
      arg: StandardSchemaV1.InferOutput<Sch>,
    ) => Effect.Effect<AsyncIterable<Output>, unknown, Env>,
  ): RemoteQueryFunction<StandardSchemaV1.InferInput<Sch>, Output>;
  <S extends Schema.Top, Output>(
    schema: S,
    fn: (arg: S["Type"]) => Effect.Effect<AsyncIterable<Output>, unknown, Env>,
  ): RemoteQueryFunction<S["Encoded"], Output>;
}

const makeQueryLive = <Env>(run: Runner): QueryLiveFn<Env> => {
  const impl = <In, Out>(
    validate: Validator,
    fn: (arg: In) => Effect.Effect<AsyncIterable<Out>, unknown, Env>,
  ) => {
    const live = getQueryLive();
    return live(toKitValidator(validate), (arg: In) => run(fn(arg)));
  };
  // SAFETY: every `QueryLiveFn` overload is (validator, handler), which `impl`
  // forwards to kit's `query.live`. Kit 3 returns a `RemoteLiveQueryFunction`,
  // which the published `QueryLiveFn` declares as `RemoteQueryFunction`; the two
  // share the callable/`current`/`loading` surface but are not comparable, so
  // the conversion goes through `unknown` until that published type is fixed.
  return impl as unknown as QueryLiveFn<Env>;
};

/** The public shape of the `form` helper, parameterised by its handler env. */
export interface FormFn<Env> {
  <Output>(fn: () => Effect.Effect<Output, unknown, Env>): RemoteForm<void, Output>;
  <Input, Output>(
    validate: "unchecked",
    fn: (
      data: Input,
      issue: InvalidField<Input & RemoteFormInput>,
    ) => Effect.Effect<Output, unknown, Env>,
  ): RemoteForm<Input & RemoteFormInput, Output>;
  <Sch extends StandardSchemaV1, Output>(
    validate: Sch,
    fn: (
      data: StandardSchemaV1.InferOutput<Sch>,
      issue: InvalidField<StandardSchemaV1.InferInput<Sch> & RemoteFormInput>,
    ) => Effect.Effect<Output, unknown, Env>,
  ): RemoteForm<StandardSchemaV1.InferInput<Sch> & RemoteFormInput, Output>;
  <S extends Schema.Top, Output>(
    validate: S,
    fn: (
      data: S["Type"],
      issue: InvalidField<S["Encoded"] & RemoteFormInput>,
    ) => Effect.Effect<Output, unknown, Env>,
  ): RemoteForm<S["Encoded"] & RemoteFormInput, Output>;
}

const makeForm = <Env>(helpers: RunHelpers): FormFn<Env> => {
  const impl = <In extends RemoteFormInput, Out>(
    arg1: Validator | EffectVoidHandler<Out, Env>,
    arg2?: (data: In, issue: InvalidField<In>) => Effect.Effect<Out, unknown, Env>,
  ) => {
    if (isBareHandler<Out, Env>(arg1)) {
      const handler = arg1;
      return AppServer.form(() => helpers.run(handler()));
    }

    if (!arg2) {
      throw new Error("form requires a handler function when a schema is provided");
    }

    return AppServer.form(toKitValidator(arg1), (data: In, issue: InvalidField<In>) =>
      helpers.runForm(arg2(data, issue), { issue, data }),
    );
  };
  // SAFETY: `impl` dispatches on the argument kind exactly as the `FormFn`
  // overloads distinguish them (bare handler, or validator then handler), and
  // returns kit's `RemoteForm` for that overload.
  return impl as FormFn<Env>;
};

/** The public shape of the `command` helper, parameterised by its handler env. */
export interface CommandFn<Env> {
  <Output>(fn: () => Effect.Effect<Output, unknown, Env>): RemoteCommand<void, Output>;
  <Input, Output>(
    validate: "unchecked",
    fn: (arg: Input) => Effect.Effect<Output, unknown, Env>,
  ): RemoteCommand<Input, Output>;
  <Sch extends StandardSchemaV1, Output>(
    validate: Sch,
    fn: (arg: StandardSchemaV1.InferOutput<Sch>) => Effect.Effect<Output, unknown, Env>,
  ): RemoteCommand<StandardSchemaV1.InferInput<Sch>, Output>;
  <S extends Schema.Top, Output>(
    validate: S,
    fn: (arg: S["Type"]) => Effect.Effect<Output, unknown, Env>,
  ): RemoteCommand<S["Encoded"], Output>;
}

const makeCommand = <Env>(run: Runner): CommandFn<Env> => {
  const impl = <In, Out>(
    arg1: Validator | EffectVoidHandler<Out, Env>,
    arg2?: EffectHandler<In, Out, Env>,
  ) => {
    if (isBareHandler<Out, Env>(arg1)) {
      const handler = arg1;
      return AppServer.command(() => run(handler()));
    }

    if (!arg2) {
      throw new Error("command requires a handler function when a schema is provided");
    }

    return AppServer.command(toKitValidator(arg1), (arg: In) => run(arg2(arg)));
  };
  // SAFETY: `impl` dispatches on the argument kind exactly as the `CommandFn`
  // overloads distinguish them (bare handler, or validator then handler), and
  // returns kit's `RemoteCommand` for that overload.
  return impl as CommandFn<Env>;
};

/** The public shape of the `prerender` helper, parameterised by its handler env. */
export interface PrerenderFn<Env> {
  <Output>(
    fn: () => Effect.Effect<Output, unknown, Env>,
    options?: {
      inputs?: () => Promise<void[]> | void[];
      dynamic?: boolean;
    },
  ): RemotePrerenderFunction<void, Output>;
  <Input, Output>(
    validate: "unchecked",
    fn: (arg: Input) => Effect.Effect<Output, unknown, Env>,
    options?: {
      inputs?: () => Promise<Input[]> | Input[];
      dynamic?: boolean;
    },
  ): RemotePrerenderFunction<Input, Output>;
  <Sch extends StandardSchemaV1, Output>(
    schema: Sch,
    fn: (arg: StandardSchemaV1.InferOutput<Sch>) => Effect.Effect<Output, unknown, Env>,
    options?: {
      inputs?: () =>
        | Promise<StandardSchemaV1.InferInput<Sch>[]>
        | StandardSchemaV1.InferInput<Sch>[];
      dynamic?: boolean;
    },
  ): RemotePrerenderFunction<StandardSchemaV1.InferInput<Sch>, Output>;
  <S extends Schema.Top, Output>(
    schema: S,
    fn: (arg: S["Type"]) => Effect.Effect<Output, unknown, Env>,
    options?: {
      inputs?: () => Promise<S["Encoded"][]> | S["Encoded"][];
      dynamic?: boolean;
    },
  ): RemotePrerenderFunction<S["Encoded"], Output>;
}

const makePrerender = <Env>(run: Runner): PrerenderFn<Env> => {
  const impl = <In, Out>(
    arg1: Validator | EffectVoidHandler<Out, Env>,
    arg2?: EffectHandler<In, Out, Env> | PrerenderOptions<void>,
    arg3?: PrerenderOptions<In>,
  ) => {
    if (isBareHandler<Out, Env>(arg1)) {
      const handler = arg1;
      return AppServer.prerender(
        () => run(handler()),
        // SAFETY: in the bare-handler overload the second argument is the
        // (optional) options object, never a handler.
        arg2 as PrerenderOptions<void> | undefined,
      );
    }

    if (!Predicate.isFunction(arg2)) {
      throw new Error("prerender requires a handler function when a schema is provided");
    }

    return AppServer.prerender(toKitValidator(arg1), (arg: In) => run(arg2(arg)), arg3);
  };
  // SAFETY: `impl` dispatches on the argument kind exactly as the
  // `PrerenderFn` overloads distinguish them (bare handler plus options, or
  // validator, handler and options), and returns kit's
  // `RemotePrerenderFunction` for that overload.
  return impl as PrerenderFn<Env>;
};

/**
 * SvelteKit's `requested` from `$app/server`, passed through. Throws when the
 * installed SvelteKit version does not provide it.
 */
export function requested<Result = unknown>(...args: unknown[]): Result {
  const requestedFn = getRequested();
  return requestedFn<Result>(...args);
}

/** A `query` with its `batch` / `live` helpers attached. */
export type QueryNamespace<Env> = QueryFn<Env> & {
  batch: QueryBatchFn<Env>;
  live: QueryLiveFn<Env>;
};

const makeQueryNamespace = <Env>(run: Runner): QueryNamespace<Env> =>
  Object.assign(makeQuery<Env>(run), {
    batch: makeQueryBatch<Env>(run),
    live: makeQueryLive<Env>(run),
  });

// ── Standalone exports (default SvelteKit per-request runtime) ──────────────

/**
 * SvelteKit's remote `query` with an Effect handler. Accepts `"unchecked"`, a
 * Standard Schema or a bare Effect `Schema` as the validator; `query.batch`
 * and `query.live` are attached.
 *
 * Handlers run on the default per-request runtime (`HttpClient` plus
 * `SvelteKitRequestEvent`); a failure that is not a SvelteKit `error()` /
 * `redirect()` becomes a 500. Use {@link withRuntime} to run on your own
 * services.
 */
export const query: QueryNamespace<SvelteKitEffectEnv> = makeQueryNamespace(defaultHelpers.run);
/**
 * SvelteKit's remote `query.batch` with an Effect handler (the same function
 * as `query.batch`).
 *
 * Handlers run on the default per-request runtime (`HttpClient` plus
 * `SvelteKitRequestEvent`); a failure that is not a SvelteKit `error()` /
 * `redirect()` becomes a 500. Use {@link withRuntime} to run on your own
 * services.
 */
export const queryBatch: QueryBatchFn<SvelteKitEffectEnv> = query.batch;
/**
 * SvelteKit's remote `query.live` with an Effect handler that returns an
 * `AsyncIterable` (the same function as `query.live`).
 *
 * Handlers run on the default per-request runtime (`HttpClient` plus
 * `SvelteKitRequestEvent`); a failure that is not a SvelteKit `error()` /
 * `redirect()` becomes a 500. Use {@link withRuntime} to run on your own
 * services.
 */
export const queryLive: QueryLiveFn<SvelteKitEffectEnv> = query.live;
/**
 * SvelteKit's remote `form` with an Effect handler.
 *
 * Handlers run on the default per-request runtime (`HttpClient` plus
 * `SvelteKitRequestEvent`); a failure that is not a SvelteKit `error()` /
 * `redirect()` becomes a 500. Use {@link withRuntime} to run on your own
 * services.
 */
export const form: FormFn<SvelteKitEffectEnv> = makeForm(defaultHelpers);
/**
 * SvelteKit's remote `command` with an Effect handler.
 *
 * Handlers run on the default per-request runtime (`HttpClient` plus
 * `SvelteKitRequestEvent`); a failure that is not a SvelteKit `error()` /
 * `redirect()` becomes a 500. Use {@link withRuntime} to run on your own
 * services.
 */
export const command: CommandFn<SvelteKitEffectEnv> = makeCommand(defaultHelpers.run);
/**
 * SvelteKit's remote `prerender` with an Effect handler.
 *
 * Handlers run on the default per-request runtime (`HttpClient` plus
 * `SvelteKitRequestEvent`); a failure that is not a SvelteKit `error()` /
 * `redirect()` becomes a 500. Use {@link withRuntime} to run on your own
 * services.
 */
export const prerender: PrerenderFn<SvelteKitEffectEnv> = makePrerender(defaultHelpers.run);

/** The set of remote-function helpers bound to a particular runner. */
export interface RemoteFunctions<Env> {
  readonly query: QueryNamespace<Env>;
  readonly form: FormFn<Env>;
  readonly command: CommandFn<Env>;
  readonly prerender: PrerenderFn<Env>;
}

/**
 * Bind the remote-function helpers to a {@link RequestRuntimeProvider} (and an
 * optional boundary error translator), so their handlers run on the provider's
 * services `Env` — your own application catalogue — instead of the fixed
 * {@link SvelteKitServices}. The Standard-Schema / `"unchecked"` validation
 * argument and the native return types (`RemoteQueryFunction`, `RemoteForm`,
 * ...) are exactly as the standalone helpers.
 *
 * For remote forms, the failure path runs `opts.formError` when provided —
 * mapping a structured/nested error shape into SvelteKit's field issues (via the
 * `issue` helper / `invalid()`) so a domain validation failure drives
 * field-level invalidation rather than a generic failure. Otherwise the form
 * falls back to `translateError`.
 *
 * @example
 * ```ts
 * const { query, form, command } = RemoteFunction.withRuntime(
 *   RequestRuntime.fromLocals((event) => event.locals.runtime),
 *   {
 *     translateError: toSvelteKit,
 *     formError: (error, { issue }) => {
 *       if (error instanceof ValidationFailure) issue.field(error.field, error.message);
 *       invalid();
 *     },
 *   },
 * );
 *
 * export const items = query(() =>
 *   Effect.gen(function* () {
 *     const db = yield* Database;
 *     return yield* db.list();
 *   }),
 * );
 * ```
 */
export function withRuntime<R>(
  provider: RequestRuntimeProvider<R, any>,
  opts?: { translateError?: ErrorTranslator; formError?: FormErrorMapper },
): RemoteFunctions<R> {
  const helpers = helpersFromProvider(
    provider,
    opts?.translateError ?? defaultTranslate,
    opts?.formError,
  );
  return {
    query: makeQueryNamespace<R>(helpers.run),
    form: makeForm<R>(helpers),
    command: makeCommand<R>(helpers.run),
    prerender: makePrerender<R>(helpers.run),
  };
}

/**
 * The remote-function helpers (`query`, `form`, `command`, `prerender`,
 * `requested`) bound to the default per-request runtime; `withRuntime` binds
 * them to your own services.
 */
export const RemoteFunction = {
  query,
  form,
  command,
  prerender,
  requested,
  withRuntime,
};
