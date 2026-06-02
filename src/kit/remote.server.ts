import * as AppServer from "$app/server";
import type {
  RemoteCommand,
  RemoteForm,
  RemoteFormInput,
  RemotePrerenderFunction,
  RemoteQueryFunction,
  InvalidField,
} from "@sveltejs/kit";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import * as HttpClient from "@effect/platform/HttpClient";
import { Effect } from "effect";
import { SvelteKitRuntime, SvelteKitRequestEvent } from "./runtime.js";

type SvelteKitEffectEnv = HttpClient.HttpClient | SvelteKitRequestEvent;

function runRemoteEffect<A, E, R extends SvelteKitEffectEnv>(
  effect: Effect.Effect<A, E, R>,
): Promise<A> {
  const event = AppServer.getRequestEvent();
  const runtime = SvelteKitRuntime.forRequest(event);
  return runtime.runPromise(effect);
}

function unavailable(name: string): never {
  throw new Error(
    `${name} is not available in the installed SvelteKit version. Update @sveltejs/kit to use this API.`,
  );
}

type UnknownEffect = Effect.Effect<unknown, unknown, SvelteKitEffectEnv>;
type EffectHandler = (arg: unknown) => UnknownEffect;
type EffectFormHandler = (data: unknown, issue: unknown) => UnknownEffect;
type EffectVoidHandler = () => UnknownEffect;

/**
 * Detects a Standard Schema validator via its `~standard` marker property.
 *
 * This cannot be a simple `typeof value === "function"` check on the handler
 * position: some Standard Schema implementations (such as Effect's
 * `Schema.standardSchemaV1`) return callable class values, which would be
 * mistaken for handler functions.
 */
const isStandardSchema = (value: unknown): value is StandardSchemaV1 =>
  value !== null &&
  (typeof value === "object" || typeof value === "function") &&
  "~standard" in value;

/** True when the argument is the no-validation handler overload. */
const isBareHandler = (value: unknown): value is EffectVoidHandler =>
  typeof value === "function" && !isStandardSchema(value);

export function query<Output>(
  fn: () => Effect.Effect<Output, unknown, SvelteKitEffectEnv>,
): RemoteQueryFunction<void, Output>;
export function query<Input, Output>(
  validate: "unchecked",
  fn: (arg: Input) => Effect.Effect<Output, unknown, SvelteKitEffectEnv>,
): RemoteQueryFunction<Input, Output>;
export function query<Schema extends StandardSchemaV1, Output>(
  schema: Schema,
  fn: (
    arg: StandardSchemaV1.InferOutput<Schema>,
  ) => Effect.Effect<Output, unknown, SvelteKitEffectEnv>,
): RemoteQueryFunction<StandardSchemaV1.InferInput<Schema>, Output>;
export function query(
  arg1: unknown,
  arg2?: (arg: unknown) => Effect.Effect<unknown, unknown, SvelteKitEffectEnv>,
): any {
  if (isBareHandler(arg1)) {
    const handler = arg1;
    return AppServer.query(() => runRemoteEffect(handler()));
  }

  if (!arg2) {
    throw new Error("query requires a handler function when a schema is provided");
  }

  return AppServer.query(arg1 as "unchecked", (arg: unknown) => runRemoteEffect(arg2(arg)));
}

export function queryBatch<Input, Output>(
  validate: "unchecked",
  fn: (
    args: Input[],
  ) => Effect.Effect<(arg: Input, idx: number) => Output, unknown, SvelteKitEffectEnv>,
): RemoteQueryFunction<Input, Output>;
export function queryBatch<Schema extends StandardSchemaV1, Output>(
  schema: Schema,
  fn: (
    args: StandardSchemaV1.InferOutput<Schema>[],
  ) => Effect.Effect<
    (arg: StandardSchemaV1.InferOutput<Schema>, idx: number) => Output,
    unknown,
    SvelteKitEffectEnv
  >,
): RemoteQueryFunction<StandardSchemaV1.InferInput<Schema>, Output>;
export function queryBatch(
  validate: unknown,
  fn: (
    args: unknown[],
  ) => Effect.Effect<(arg: unknown, idx: number) => unknown, unknown, SvelteKitEffectEnv>,
): any {
  return AppServer.query.batch(validate as "unchecked", (args: unknown[]) =>
    runRemoteEffect(fn(args)),
  );
}

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

export function queryLive<Input, Output>(
  validate: "unchecked",
  fn: (arg: Input) => Effect.Effect<AsyncIterable<Output>, unknown, SvelteKitEffectEnv>,
): RemoteQueryFunction<Input, Output>;
export function queryLive<Schema extends StandardSchemaV1, Output>(
  schema: Schema,
  fn: (
    arg: StandardSchemaV1.InferOutput<Schema>,
  ) => Effect.Effect<AsyncIterable<Output>, unknown, SvelteKitEffectEnv>,
): RemoteQueryFunction<StandardSchemaV1.InferInput<Schema>, Output>;
export function queryLive(
  validate: unknown,
  fn: (arg: unknown) => Effect.Effect<AsyncIterable<unknown>, unknown, SvelteKitEffectEnv>,
): any {
  const live = getQueryLive();
  return live(validate, (arg) => runRemoteEffect(fn(arg)));
}

export function form<Output>(
  fn: () => Effect.Effect<Output, unknown, SvelteKitEffectEnv>,
): RemoteForm<void, Output>;
export function form<Input extends RemoteFormInput, Output>(
  validate: "unchecked",
  fn: (
    data: Input,
    issue: InvalidField<Input>,
  ) => Effect.Effect<Output, unknown, SvelteKitEffectEnv>,
): RemoteForm<Input, Output>;
export function form<Schema extends StandardSchemaV1<RemoteFormInput, Record<string, any>>, Output>(
  validate: Schema,
  fn: (
    data: StandardSchemaV1.InferOutput<Schema>,
    issue: InvalidField<StandardSchemaV1.InferInput<Schema>>,
  ) => Effect.Effect<Output, unknown, SvelteKitEffectEnv>,
): RemoteForm<StandardSchemaV1.InferInput<Schema>, Output>;
export function form(arg1: unknown, arg2?: unknown): any {
  if (isBareHandler(arg1)) {
    const handler = arg1;
    return AppServer.form(() => runRemoteEffect(handler()));
  }

  if (!arg2) {
    throw new Error("form requires a handler function when a schema is provided");
  }

  return AppServer.form(arg1 as "unchecked", (data: unknown, issue: unknown) =>
    runRemoteEffect((arg2 as EffectFormHandler)(data, issue)),
  );
}

export function command<Output>(
  fn: () => Effect.Effect<Output, unknown, SvelteKitEffectEnv>,
): RemoteCommand<void, Output>;
export function command<Input, Output>(
  validate: "unchecked",
  fn: (arg: Input) => Effect.Effect<Output, unknown, SvelteKitEffectEnv>,
): RemoteCommand<Input, Output>;
export function command<Schema extends StandardSchemaV1, Output>(
  validate: Schema,
  fn: (
    arg: StandardSchemaV1.InferOutput<Schema>,
  ) => Effect.Effect<Output, unknown, SvelteKitEffectEnv>,
): RemoteCommand<StandardSchemaV1.InferInput<Schema>, Output>;
export function command(
  arg1: unknown,
  arg2?: (arg: unknown) => Effect.Effect<unknown, unknown, SvelteKitEffectEnv>,
): any {
  if (isBareHandler(arg1)) {
    const handler = arg1;
    return AppServer.command(() => runRemoteEffect(handler()));
  }

  if (!arg2) {
    throw new Error("command requires a handler function when a schema is provided");
  }

  return AppServer.command(arg1 as "unchecked", (arg: unknown) => runRemoteEffect(arg2(arg)));
}

export function prerender<Output>(
  fn: () => Effect.Effect<Output, unknown, SvelteKitEffectEnv>,
  options?: {
    inputs?: () => Promise<void[]> | void[];
    dynamic?: boolean;
  },
): RemotePrerenderFunction<void, Output>;
export function prerender<Input, Output>(
  validate: "unchecked",
  fn: (arg: Input) => Effect.Effect<Output, unknown, SvelteKitEffectEnv>,
  options?: {
    inputs?: () => Promise<Input[]> | Input[];
    dynamic?: boolean;
  },
): RemotePrerenderFunction<Input, Output>;
export function prerender<Schema extends StandardSchemaV1, Output>(
  schema: Schema,
  fn: (
    arg: StandardSchemaV1.InferOutput<Schema>,
  ) => Effect.Effect<Output, unknown, SvelteKitEffectEnv>,
  options?: {
    inputs?: () =>
      | Promise<StandardSchemaV1.InferInput<Schema>[]>
      | StandardSchemaV1.InferInput<Schema>[];
    dynamic?: boolean;
  },
): RemotePrerenderFunction<StandardSchemaV1.InferInput<Schema>, Output>;
export function prerender(
  arg1: unknown,
  arg2?:
    | ((arg: unknown) => Effect.Effect<unknown, unknown, SvelteKitEffectEnv>)
    | {
        inputs?: () => Promise<unknown[]> | unknown[];
        dynamic?: boolean;
      },
  arg3?: {
    inputs?: () => Promise<unknown[]> | unknown[];
    dynamic?: boolean;
  },
): any {
  if (isBareHandler(arg1)) {
    const handler = arg1;
    return AppServer.prerender(
      () => runRemoteEffect(handler()),
      arg2 as { inputs?: () => Promise<void[]> | void[]; dynamic?: boolean } | undefined,
    );
  }

  if (typeof arg2 !== "function") {
    throw new Error("prerender requires a handler function when a schema is provided");
  }

  return AppServer.prerender(
    arg1 as "unchecked",
    (arg: unknown) => runRemoteEffect((arg2 as EffectHandler)(arg)),
    arg3,
  );
}

export function requested<Result = unknown>(...args: unknown[]): Result {
  const requestedFn = getRequested();
  return requestedFn(...args) as Result;
}

type QueryNamespace = {
  <Output>(
    fn: () => Effect.Effect<Output, unknown, SvelteKitEffectEnv>,
  ): RemoteQueryFunction<void, Output>;
  <Input, Output>(
    validate: "unchecked",
    fn: (arg: Input) => Effect.Effect<Output, unknown, SvelteKitEffectEnv>,
  ): RemoteQueryFunction<Input, Output>;
  <Schema extends StandardSchemaV1, Output>(
    schema: Schema,
    fn: (
      arg: StandardSchemaV1.InferOutput<Schema>,
    ) => Effect.Effect<Output, unknown, SvelteKitEffectEnv>,
  ): RemoteQueryFunction<StandardSchemaV1.InferInput<Schema>, Output>;
  batch: typeof queryBatch;
  live: typeof queryLive;
};

const queryWithHelpers = Object.assign(query, {
  batch: queryBatch,
  live: queryLive,
}) as QueryNamespace;

export const RemoteFunction = {
  query: queryWithHelpers,
  form,
  command,
  prerender,
  requested,
};
