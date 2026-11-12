/**
 * The error-translator contract (#273): a translator only throws, except a
 * form action's, which may return `fail()`'s `ActionFailure`. Only the action
 * wrappers accept that one, and they carry the failure in their result type.
 */

import { it } from "@effect/vitest";
import {
  error,
  fail,
  isActionFailure,
  isHttpError,
  type Action,
  type ActionFailure,
} from "@sveltejs/kit";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { assert, describe, expect, expectTypeOf } from "vite-plus/test";
import { makeServerRuntime, type ServerRuntimeOptions } from "../src/app-runtime.js";
import * as Errors from "../src/errors.js";
import { wrapAction, wrapActions } from "../src/internal/auto.js";
import { EffectCauseError } from "../src/internal/error.js";
import {
  KitActionFailure,
  SvelteKit,
  type ActionFailureOf,
  type KitActionErrorTranslator,
  type KitErrorTranslator,
  type KitTranslatorCase,
} from "../src/kit.js";
import {
  makeRuntimeAdapter,
  RequestRuntime,
  type ErrorTranslator,
  type RuntimeAdapterOptions,
} from "../src/request-runtime.js";
import {
  runAction,
  runServerLoad,
  TestRequestEvent,
  type RunRemoteOptions,
  type TestActionOptions,
  type TestRunOptions,
} from "../src/testing.js";
import { mockEvent } from "./fixtures/request-event.js";

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  resource: Schema.String,
}) {}
class Invalid extends Schema.TaggedError<Invalid>()("Invalid", {
  field: Schema.String,
}) {}
type AppError = NotFound | Invalid;

/** The data the action translators below fail with. */
interface FieldFailure {
  readonly field: string;
}

/** The app's shared, throw-only translator: what its loads use. */
const translateError = Errors.toSvelteKit<AppError>({ NotFound: 404 });

/** The app's action translator: `fail()` for `Invalid`, else the shared one. */
const translateActionError = Errors.toSvelteKit<AppError, ActionFailure<FieldFailure>>(
  { Invalid: (e) => fail(422, { field: e.field }) },
  { fallback: translateError },
);

const emptyProvider = RequestRuntime.fromLayer(Layer.empty);

/** A throw-only case that returns an `ActionFailure` all the same. */
const returning: KitTranslatorCase = () => fail(422, { field: "email" });

/** A handler that fails with an error of the shared translator's catalogue. */
const failing = () => Effect.fail(new NotFound({ resource: "notes" }));

/** What an `Action` resolves with. */
type ActionResult<A extends Action<any, any, any>> = Awaited<ReturnType<A>>;

describe("the translator types", () => {
  it("a throw-only translator is every wrapper's translator, an action's included", () => {
    expectTypeOf<KitErrorTranslator>().toEqualTypeOf<ErrorTranslator>();
    expectTypeOf<KitErrorTranslator>().toExtend<KitActionErrorTranslator<FieldFailure>>();
    expectTypeOf(translateError).toEqualTypeOf<KitErrorTranslator>();
    expectTypeOf(SvelteKit.translate).toEqualTypeOf<KitErrorTranslator>();
    expectTypeOf(SvelteKit.translate).returns.toBeNever();
  });

  it("a translator that returns an ActionFailure is not a throw-only one", () => {
    expectTypeOf(translateActionError).toEqualTypeOf<KitActionErrorTranslator<FieldFailure>>();
    expectTypeOf(translateActionError).returns.toEqualTypeOf<ActionFailure<FieldFailure>>();
    expectTypeOf<KitActionErrorTranslator<FieldFailure>>().not.toExtend<KitErrorTranslator>();
    expectTypeOf<KitActionErrorTranslator<FieldFailure>>().not.toExtend<ErrorTranslator>();
  });

  it("loads, hooks, endpoints and remote functions reject a failure-returning translator", () => {
    interface WithFailing {
      readonly translateError: KitActionErrorTranslator<FieldFailure>;
    }
    interface WithThrowing {
      readonly translateError: KitErrorTranslator;
    }
    // `translateError` is the translator of `serverLoad` / `endpoint` (and of
    // `handle`, `handleFetch`, `handleError`, `init` on a server runtime).
    expectTypeOf<WithFailing>().not.toExtend<RuntimeAdapterOptions>();
    expectTypeOf<WithFailing>().not.toExtend<RuntimeAdapterOptions<ActionFailure<FieldFailure>>>();
    expectTypeOf<WithFailing>().not.toExtend<ServerRuntimeOptions>();
    expectTypeOf<WithFailing>().not.toExtend<ServerRuntimeOptions<ActionFailure<FieldFailure>>>();
    expectTypeOf<WithFailing>().not.toExtend<TestRunOptions<never>>();
    expectTypeOf<WithFailing>().not.toExtend<
      TestActionOptions<never, ActionFailure<FieldFailure>>
    >();
    expectTypeOf<WithFailing>().not.toExtend<RunRemoteOptions<never>>();
    expectTypeOf<WithFailing>().not.toExtend<
      NonNullable<Parameters<typeof makeRuntimeAdapter>[1]>
    >();
    // The same options take a throw-only translator.
    expectTypeOf<WithThrowing>().toExtend<RuntimeAdapterOptions>();
    expectTypeOf<WithThrowing>().toExtend<ServerRuntimeOptions>();
    expectTypeOf<WithThrowing>().toExtend<TestRunOptions<never>>();
    expectTypeOf<WithThrowing>().toExtend<RunRemoteOptions<never>>();
  });

  it("only translateActionError takes one, and only with the failure in the options' type", () => {
    interface WithActionFailing {
      readonly translateActionError: KitActionErrorTranslator<FieldFailure>;
    }
    expectTypeOf<WithActionFailing>().toExtend<
      RuntimeAdapterOptions<ActionFailure<FieldFailure>>
    >();
    expectTypeOf<WithActionFailing>().toExtend<ServerRuntimeOptions<ActionFailure<FieldFailure>>>();
    expectTypeOf<WithActionFailing>().toExtend<
      TestActionOptions<never, ActionFailure<FieldFailure>>
    >();
    expectTypeOf<WithActionFailing>().not.toExtend<RuntimeAdapterOptions>();
    expectTypeOf<WithActionFailing>().not.toExtend<ServerRuntimeOptions>();
    // A throw-only translator is an action translator too.
    expectTypeOf<{
      readonly translateActionError: KitErrorTranslator;
    }>().toExtend<RuntimeAdapterOptions>();
  });

  it("a catalogue entry or a translator case may return fail() for actions only", () => {
    type FailingEntry = (error: Invalid) => ActionFailure<FieldFailure>;
    expectTypeOf<FailingEntry>().not.toExtend<Errors.CatalogueEntry<Invalid>>();
    expectTypeOf<FailingEntry>().toExtend<
      Errors.CatalogueEntry<Invalid, ActionFailure<FieldFailure>>
    >();
    expectTypeOf<{ readonly Invalid: FailingEntry }>().not.toExtend<Errors.Catalogue<AppError>>();
    expectTypeOf<{ readonly Invalid: FailingEntry }>().toExtend<
      Errors.Catalogue<AppError, ActionFailure<FieldFailure>>
    >();
    // A throw-only catalogue's fallback is throw-only as well.
    expectTypeOf<{
      readonly fallback: KitActionErrorTranslator<FieldFailure>;
    }>().not.toExtend<Errors.ToSvelteKitOptions>();

    // A throw-only case has no result; an action case may have one.
    expectTypeOf<ReturnType<KitTranslatorCase>>().toBeVoid();
    expectTypeOf<
      ReturnType<KitTranslatorCase<ActionFailure<FieldFailure>>>
    >().toEqualTypeOf<void | ActionFailure<FieldFailure>>();
    expectTypeOf(SvelteKit.makeTranslator).returns.toEqualTypeOf<KitErrorTranslator>();
    expectTypeOf(SvelteKit.makeActionTranslator<FieldFailure>).returns.toEqualTypeOf<
      KitActionErrorTranslator<FieldFailure>
    >();
  });
});

describe("ActionFailureOf", () => {
  it("reads the fail() data off the declared error type", () => {
    expectTypeOf<ActionFailureOf<KitActionFailure<FieldFailure>>>().toEqualTypeOf<
      ActionFailure<FieldFailure>
    >();
    expectTypeOf<ActionFailureOf<KitActionFailure<FieldFailure> | NotFound>>().toEqualTypeOf<
      ActionFailure<FieldFailure>
    >();
    expectTypeOf<
      ActionFailureOf<KitActionFailure<FieldFailure> | KitActionFailure<{ readonly n: number }>>
    >().toEqualTypeOf<ActionFailure<FieldFailure> | ActionFailure<{ readonly n: number }>>();
  });

  it("is never for an error type that declares no failure", () => {
    expectTypeOf<ActionFailureOf<never>>().toBeNever();
    expectTypeOf<ActionFailureOf<NotFound>>().toBeNever();
    expectTypeOf<ActionFailureOf<unknown>>().toBeNever();
  });
});

describe("SvelteKit.failuresReturned", () => {
  it.effect("turns a SvelteKit.fail() failure into the Effect's result", () =>
    Effect.gen(function* () {
      const result = yield* SvelteKit.failuresReturned(
        Effect.gen(function* () {
          yield* SvelteKit.fail(422, { field: "email" });
          return { saved: true as const };
        }),
      );
      expectTypeOf(result).toEqualTypeOf<{ saved: true } | ActionFailure<{ field: string }>>();
      assert(isActionFailure(result), "expected an ActionFailure");
      expect(result.status).toBe(422);
      expect(result.data).toEqual({ field: "email" });
    }),
  );

  it.effect("leaves every other failure in the error channel", () =>
    Effect.gen(function* () {
      const failure = new NotFound({ resource: "notes" });
      const flipped = yield* Effect.flip(SvelteKit.failuresReturned(Effect.fail(failure)));
      expect(flipped).toBe(failure);
    }),
  );

  it("KitActionFailure.actionFailure is SvelteKit's fail(status, data)", () => {
    const failure = new KitActionFailure(409, { field: "name" });
    expectTypeOf(failure.actionFailure).toEqualTypeOf<ActionFailure<{ field: string }>>();
    assert(isActionFailure(failure.actionFailure));
    expect(failure.actionFailure).toEqual(fail(409, { field: "name" }));
  });
});

describe("SvelteKit.translate", () => {
  it("throws a KitActionFailure as a 500: fail() has no thrown form", () => {
    const cause = Cause.fail(new KitActionFailure(422, { field: "email" }));
    const result = Result.try(() => SvelteKit.translate(cause));
    assert(Result.isFailure(result), "SvelteKit.translate did not throw");
    assert.instanceOf(result.failure, EffectCauseError);
    expect(result.failure.cause).toBe(cause);
  });

  it("a load that fails with SvelteKit.fail() rejects, with any translator", async () => {
    const event = TestRequestEvent();
    await expect(
      runServerLoad(() => SvelteKit.fail(422, { field: "email" }), event),
    ).rejects.toThrow(EffectCauseError);
    await expect(
      runServerLoad(() => SvelteKit.fail(422, { field: "email" }), event, { translateError }),
    ).rejects.toThrow(EffectCauseError);
  });
});

describe("SvelteKit.makeTranslator", () => {
  it("ignores what a case returns, an ActionFailure included", () => {
    const translate = SvelteKit.makeTranslator([returning]);
    expect(() => translate(Cause.fail(new Invalid({ field: "email" })))).toThrow(EffectCauseError);
  });
});

describe("SvelteKit.makeActionTranslator", () => {
  const translate = SvelteKit.makeActionTranslator<FieldFailure>([
    (e) => (e instanceof Invalid ? fail(422, { field: e.field }) : undefined),
    (e) => {
      if (e instanceof NotFound) error(404, e.resource);
    },
  ]);

  it("returns the fail() of the first case that returns one", () => {
    const result = translate(Cause.fail(new Invalid({ field: "email" })));
    expectTypeOf(result).toEqualTypeOf<ActionFailure<FieldFailure>>();
    expect(isActionFailure(result)).toBe(true);
    expect(result.status).toBe(422);
    expect(result.data).toEqual({ field: "email" });
  });

  it("throws what a case throws", () => {
    const result = Result.try(() => translate(Cause.fail(new NotFound({ resource: "notes" }))));
    assert(Result.isFailure(result), "the translator did not throw");
    assert(isHttpError(result.failure), "expected an HttpError");
    expect(result.failure.status).toBe(404);
  });

  it("falls back to SvelteKit.translate, or to the translator it is given", () => {
    expect(() => translate(Cause.fail("boom"))).toThrow(EffectCauseError);

    const onShared = SvelteKit.makeActionTranslator<FieldFailure>(
      [(e) => (e instanceof Invalid ? fail(422, { field: e.field }) : undefined)],
      translateError,
    );
    const result = Result.try(() => onShared(Cause.fail(new NotFound({ resource: "notes" }))));
    assert(Result.isFailure(result), "the translator did not throw");
    assert(isHttpError(result.failure), "expected an HttpError");
    expect(result.failure.status).toBe(404);
  });
});

describe("makeRuntimeAdapter actions", () => {
  it("a SvelteKit.fail() failure is the action's result, with typed data", async () => {
    const { action } = makeRuntimeAdapter(emptyProvider);
    const save = action(() =>
      Effect.gen(function* () {
        yield* SvelteKit.fail(422, { field: "email" });
        return { saved: true as const };
      }),
    );
    expectTypeOf<ActionResult<typeof save>>().toEqualTypeOf<
      { saved: true } | ActionFailure<{ field: string }>
    >();
    const result = await save(mockEvent());
    assert(isActionFailure(result), "expected an ActionFailure");
    expect(result.status).toBe(422);
    expect(result.data).toEqual({ field: "email" });
  });

  it("an action that cannot fail() keeps its own result type", async () => {
    const { action, actions } = makeRuntimeAdapter(emptyProvider);
    const save = action(() => Effect.succeed({ saved: true as const }));
    expectTypeOf<ActionResult<typeof save>>().toEqualTypeOf<{ saved: true }>();
    expect(await save(mockEvent())).toEqual({ saved: true });

    const all = actions({ save: () => Effect.fail(new NotFound({ resource: "notes" })) });
    expectTypeOf<ActionResult<(typeof all)[string]>>().toBeNever();
  });

  it("translateActionError's fail() reaches the action's return value, typed", async () => {
    const { action, actions, serverLoad } = makeRuntimeAdapter(emptyProvider, {
      translateError,
      translateActionError,
    });
    const save = action(() =>
      Effect.gen(function* () {
        yield* new Invalid({ field: "email" });
        return { saved: true as const };
      }),
    );
    expectTypeOf<ActionResult<typeof save>>().toEqualTypeOf<
      { saved: true } | ActionFailure<FieldFailure>
    >();
    const result = await save(mockEvent());
    assert(isActionFailure(result), "expected an ActionFailure");
    expect(result.status).toBe(422);
    expect(result.data).toEqual({ field: "email" });

    const all = actions({
      save: () => Effect.fail(new Invalid({ field: "name" })),
    });
    expectTypeOf<ActionResult<(typeof all)[string]>>().toEqualTypeOf<ActionFailure<FieldFailure>>();
    const fromMap = await all.save(mockEvent());
    expect(isActionFailure(fromMap)).toBe(true);
    expect(fromMap.data).toEqual({ field: "name" });

    // What the action translator does not fail() goes to its fallback: the
    // translator the loads use.
    const missing = action(() => Effect.fail(new NotFound({ resource: "notes" })));
    await expect(missing(mockEvent())).rejects.toSatisfy((e) => isHttpError(e) && e.status === 404);

    // The loads keep the throw-only translator: Invalid is not in its
    // catalogue, so it is a 500.
    const load = serverLoad(() => Effect.fail(new Invalid({ field: "email" })));
    expectTypeOf<Awaited<ReturnType<typeof load>>>().toBeNever();
    await expect(load(mockEvent())).rejects.toThrow(EffectCauseError);
  });

  it("one throw-only translator serves loads and actions", async () => {
    const { action, serverLoad } = makeRuntimeAdapter(emptyProvider, { translateError });
    await expect(serverLoad(failing)(mockEvent())).rejects.toSatisfy(
      (e) => isHttpError(e) && e.status === 404,
    );
    await expect(action(failing)(mockEvent())).rejects.toSatisfy(
      (e) => isHttpError(e) && e.status === 404,
    );
    // And the action still returns its own SvelteKit.fail().
    const result = await action(() => SvelteKit.fail(400, { field: "x" }))(mockEvent());
    expect(isActionFailure(result)).toBe(true);
    expect(result.data).toEqual({ field: "x" });
  });
});

describe("makeServerRuntime actions", () => {
  it("a SvelteKit.fail() failure is the action's result, with typed data", async () => {
    const runtime = makeServerRuntime();
    const save = runtime.action(() =>
      Effect.gen(function* () {
        yield* SvelteKit.fail(422, { field: "email" });
        return { saved: true as const };
      }),
    );
    expectTypeOf<ActionResult<typeof save>>().toEqualTypeOf<
      { saved: true } | ActionFailure<{ field: string }>
    >();
    const result = await save(mockEvent());
    assert(isActionFailure(result), "expected an ActionFailure");
    expect(result.data).toEqual({ field: "email" });
    await runtime.dispose();
  });

  it("translateActionError's fail() reaches actions only", async () => {
    const runtime = makeServerRuntime(Layer.empty, { translateError, translateActionError });
    const save = runtime.action(() => Effect.fail(new Invalid({ field: "email" })));
    expectTypeOf<ActionResult<typeof save>>().toEqualTypeOf<ActionFailure<FieldFailure>>();
    const result = await save(mockEvent());
    expect(isActionFailure(result)).toBe(true);
    expect(result.status).toBe(422);
    expect(result.data).toEqual({ field: "email" });

    const all = runtime.actions({ save: () => Effect.fail(new Invalid({ field: "name" })) });
    const fromMap = await all.save(mockEvent());
    expect(isActionFailure(fromMap)).toBe(true);
    expect(fromMap.data).toEqual({ field: "name" });

    const load = runtime.serverLoad(() => Effect.fail(new Invalid({ field: "email" })));
    await expect(load(mockEvent())).rejects.toThrow(EffectCauseError);
    const endpoint = runtime.endpoint(() => Effect.fail(new NotFound({ resource: "notes" })));
    await expect(endpoint(mockEvent())).rejects.toSatisfy(
      (e) => isHttpError(e) && e.status === 404,
    );
    await runtime.dispose();
  });

  it("without translateActionError, actions use translateError", async () => {
    const runtime = makeServerRuntime(Layer.empty, { translateError });
    const missing = runtime.action(() => Effect.fail(new NotFound({ resource: "notes" })));
    expectTypeOf<ActionResult<typeof missing>>().toBeNever();
    await expect(missing(mockEvent())).rejects.toSatisfy((e) => isHttpError(e) && e.status === 404);
    await runtime.dispose();
  });
});

describe("the auto-wrapped actions", () => {
  it("return a SvelteKit.fail() failure, and the runtime's translateActionError fail()", async () => {
    const own = wrapAction(() => SvelteKit.fail(422, { field: "email" }));
    const ownResult = await own(mockEvent());
    assert(isActionFailure(ownResult), "expected an ActionFailure");
    expect(ownResult.data).toEqual({ field: "email" });

    const runtime = makeServerRuntime(Layer.empty, { translateError, translateActionError });
    const all = wrapActions(
      {
        save: () => Effect.fail(new Invalid({ field: "name" })),
        find: () => Effect.fail(new NotFound({ resource: "notes" })),
        plain: async () => ({ plain: true }),
      },
      { runtime },
    );
    const translated = await all.save(mockEvent());
    assert(isActionFailure(translated), "expected an ActionFailure");
    expect(translated.status).toBe(422);
    expect(translated.data).toEqual({ field: "name" });
    await expect(all.find(mockEvent())).rejects.toSatisfy(
      (e) => isHttpError(e) && e.status === 404,
    );
    expect(await all.plain(mockEvent())).toEqual({ plain: true });
    await runtime.dispose();
  });
});

describe("runAction", () => {
  const event = TestRequestEvent({ method: "POST" });

  it("types a SvelteKit.fail() failure in its result", async () => {
    const result = await runAction(
      () =>
        Effect.gen(function* () {
          yield* SvelteKit.fail(422, { field: "email" });
          return { saved: true as const };
        }),
      event,
    );
    expectTypeOf(result).toEqualTypeOf<{ saved: true } | ActionFailure<{ field: string }>>();
    assert(isActionFailure(result), "expected an ActionFailure");
    expect(result.data).toEqual({ field: "email" });
  });

  it("resolves with the fail() opts.translateActionError returns", async () => {
    const result = await runAction(() => Effect.fail(new Invalid({ field: "email" })), event, {
      translateActionError,
    });
    expectTypeOf(result).toEqualTypeOf<ActionFailure<FieldFailure>>();
    expect(isActionFailure(result)).toBe(true);
    expect(result.status).toBe(422);
    expect(result.data).toEqual({ field: "email" });
  });

  it("uses a throw-only opts.translateError for the action too", async () => {
    await expect(
      runAction(() => Effect.fail(new NotFound({ resource: "notes" })), event, { translateError }),
    ).rejects.toSatisfy((e) => isHttpError(e) && e.status === 404);
  });
});
