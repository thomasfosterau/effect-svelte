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
import type * as Schema from "effect/Schema";
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

type EffectHandler<Env> = (arg: unknown) => Effect.Effect<unknown, unknown, Env>;
type EffectFormHandler<Env> = (
  data: unknown,
  issue: unknown,
) => Effect.Effect<unknown, unknown, Env>;
type EffectVoidHandler<Env> = () => Effect.Effect<unknown, unknown, Env>;

/** True when the argument is the no-validation handler overload (typed narrowing). */
const isBareHandler = <Env>(value: unknown): value is EffectVoidHandler<Env> =>
  isBareHandlerValue(value);

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

const makeQuery = <Env>(run: Runner): QueryFn<Env> =>
  ((arg1: unknown, arg2?: (arg: unknown) => Effect.Effect<unknown, unknown, Env>): any => {
    if (isBareHandler<Env>(arg1)) {
      const handler = arg1;
      return AppServer.query(() => run(handler()));
    }

    if (!arg2) {
      throw new Error("query requires a handler function when a schema is provided");
    }

    return AppServer.query(toStandardValidator(arg1) as "unchecked", (arg: unknown) =>
      run(arg2(arg)),
    );
  }) as QueryFn<Env>;

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

const makeQueryBatch = <Env>(run: Runner): QueryBatchFn<Env> =>
  ((
    validate: unknown,
    fn: (args: unknown[]) => Effect.Effect<(arg: unknown, idx: number) => unknown, unknown, Env>,
  ): any =>
    AppServer.query.batch(toStandardValidator(validate) as "unchecked", (args: unknown[]) =>
      run(fn(args)),
    )) as QueryBatchFn<Env>;

type QueryLiveFactory = (
  validate: unknown,
  fn: (arg: unknown) => Promise<AsyncIterable<unknown>> | AsyncIterable<unknown>,
) => unknown;

type QueryWithCompat = typeof AppServer.query & {
  live?: QueryLiveFactory;
};

type AppServerWithCompat = typeof AppServer & {
  requested?: (...args: unknown[]) => unknown;
};

const appServerCompat = AppServer as AppServerWithCompat;
const queryCompat = AppServer.query as QueryWithCompat;

function getQueryLive(): QueryLiveFactory {
  const live = queryCompat.live;

  if (typeof live !== "function") {
    unavailable("query.live");
  }

  return live;
}

function getRequested(): (...args: unknown[]) => unknown {
  const requestedFn = appServerCompat.requested;

  if (typeof requestedFn !== "function") {
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

const makeQueryLive = <Env>(run: Runner): QueryLiveFn<Env> =>
  ((
    validate: unknown,
    fn: (arg: unknown) => Effect.Effect<AsyncIterable<unknown>, unknown, Env>,
  ): any => {
    const live = getQueryLive();
    return live(toStandardValidator(validate), (arg) => run(fn(arg)));
  }) as QueryLiveFn<Env>;

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

const makeForm = <Env>(helpers: RunHelpers): FormFn<Env> =>
  ((arg1: unknown, arg2?: unknown): any => {
    if (isBareHandler<Env>(arg1)) {
      const handler = arg1;
      return AppServer.form(() => helpers.run(handler()));
    }

    if (!arg2) {
      throw new Error("form requires a handler function when a schema is provided");
    }

    return AppServer.form(
      toStandardValidator(arg1) as "unchecked",
      (data: unknown, issue: unknown) =>
        helpers.runForm((arg2 as EffectFormHandler<Env>)(data, issue), {
          issue: issue as InvalidField<any>,
          data,
        }),
    );
  }) as FormFn<Env>;

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

const makeCommand = <Env>(run: Runner): CommandFn<Env> =>
  ((arg1: unknown, arg2?: (arg: unknown) => Effect.Effect<unknown, unknown, Env>): any => {
    if (isBareHandler<Env>(arg1)) {
      const handler = arg1;
      return AppServer.command(() => run(handler()));
    }

    if (!arg2) {
      throw new Error("command requires a handler function when a schema is provided");
    }

    return AppServer.command(toStandardValidator(arg1) as "unchecked", (arg: unknown) =>
      run(arg2(arg)),
    );
  }) as CommandFn<Env>;

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

const makePrerender = <Env>(run: Runner): PrerenderFn<Env> =>
  ((
    arg1: unknown,
    arg2?:
      | ((arg: unknown) => Effect.Effect<unknown, unknown, Env>)
      | {
          inputs?: () => Promise<unknown[]> | unknown[];
          dynamic?: boolean;
        },
    arg3?: {
      inputs?: () => Promise<unknown[]> | unknown[];
      dynamic?: boolean;
    },
  ): any => {
    if (isBareHandler<Env>(arg1)) {
      const handler = arg1;
      return AppServer.prerender(
        () => run(handler()),
        arg2 as { inputs?: () => Promise<void[]> | void[]; dynamic?: boolean } | undefined,
      );
    }

    if (typeof arg2 !== "function") {
      throw new Error("prerender requires a handler function when a schema is provided");
    }

    return AppServer.prerender(
      toStandardValidator(arg1) as "unchecked",
      (arg: unknown) => run((arg2 as EffectHandler<Env>)(arg)),
      arg3,
    );
  }) as PrerenderFn<Env>;

/**
 * SvelteKit's `requested` from `$app/server`, passed through. Throws when the
 * installed SvelteKit version does not provide it.
 */
export function requested<Result = unknown>(...args: unknown[]): Result {
  const requestedFn = getRequested();
  return requestedFn(...args) as Result;
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
  }) as QueryNamespace<Env>;

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
