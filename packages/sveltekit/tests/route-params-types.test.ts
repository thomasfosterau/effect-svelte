import { describe, expectTypeOf, it } from "vite-plus/test";
import type { Action, Actions, Load, RequestHandler, ServerLoad } from "@sveltejs/kit";
import { Effect } from "effect";
import type { RuntimeAdapter } from "../src/request-runtime.js";
import type { ServerRuntime, UniversalRuntime } from "../src/app-runtime.js";

// The wrappers are referenced via `typeof import(...)` (a type-only query, never
// a runtime import) so this suite — like `remote-form-types.test.ts` — does not
// pull `../src/server.ts`'s `$app/server` dependency into the test runtime. The
// `typeChecks` body below is type-checked by `vp check`, never executed.
declare const serverLoad: typeof import("../src/server.js").serverLoad;
declare const action: typeof import("../src/server.js").action;
declare const actions: typeof import("../src/server.js").actions;
declare const endpoint: typeof import("../src/server.js").endpoint;
declare const universalLoad: typeof import("../src/universal.js").load;

// SvelteKit's own `ServerLoad` / `Load` / `Action` / `RequestHandler` constrain
// their route `Params` to the *generated* `LayoutParams<'/'>`. For a root
// `+layout`, whose params span the whole route tree, that is a partial /
// index-signature record (e.g. `Partial<Record<string, string>>` — value type
// `string | undefined`), which is NOT assignable to a bare `Record<string,
// string>`. So a generated `LayoutServerLoad` annotation carries param types the
// old wrappers rejected.
//
// The regression this suite guards against: the wrappers hardcoded
// `Params extends Record<string, string> = any`, which (a) defaulted params to
// `any`, dropping param typing, and (b) was more restrictive than SvelteKit's
// own base. The wrappers now mirror SvelteKit's base (`SvelteRouteParams`), so
// they accept exactly what SvelteKit accepts — no more, no less.
//
// NOTE: in a bare type-check (no generated `$app/types`), SvelteKit's base
// resolves to `Record<string, string>`, so a literal `Partial<Record<string,
// string>>` can't be exercised here (SvelteKit itself rejects it). The invariant
// we pin down in every environment is that each wrapper's param type equals
// SvelteKit's own — which is what breaks the moment a wrapper clamps tighter (or
// defaults to `any`).

// The `params` type a handler accepted by `Wrap` sees, at default generics.
type HandlerParams<Fn> = Fn extends (event: infer E, ...rest: never[]) => unknown
  ? E extends { params: infer P }
    ? P
    : never
  : never;
type WrapperParams<Wrap> = Wrap extends (fn: infer Fn, ...rest: never[]) => unknown
  ? HandlerParams<Fn>
  : never;

// SvelteKit's own default param types for each handler kind.
type KitServerLoadParams = HandlerParams<ServerLoad>;
type KitActionParams = HandlerParams<Action>;
type KitRequestHandlerParams = HandlerParams<RequestHandler>;
type KitLoadParams = HandlerParams<Load>;

// A concrete route (`[id]`) and a root-layout shape (optional child params).
type RouteParams = { id: string };
type LayoutShape = { type?: string; id?: string };

// The runtime-bound wrappers are `declare`d (never constructed) so this suite
// stays a pure type check.
declare const adapter: RuntimeAdapter<never>;
declare const server: ServerRuntime;
declare const universal: UniversalRuntime;

export function typeChecks() {
  // ── 0. an un-annotated wrapper call resolves params to SvelteKit's base ────
  // A bare call (no contextual annotation) instantiates `Params` to its default.
  // The regression's default was `any` — silently dropping param typing — so the
  // handler's `event.params` here must be SvelteKit's own default, not `any`.
  // (Unlike `infer`/`ReturnType`, a value-level call observes the *default*, not
  // the constraint, so this is the assertion that fails on the old signature.)
  const bareServerLoad = serverLoad(() => Effect.succeed({ ok: true }));
  const bareAction = action(() => Effect.succeed({ ok: true }));
  const bareEndpoint = endpoint(() => Effect.succeed(new Response()));
  const bareUniversalLoad = universalLoad(() => Effect.succeed({ ok: true }));
  const bareAdapterLoad = adapter.serverLoad(() => Effect.succeed({ ok: true }));
  const bareServerRtLoad = server.serverLoad(() => Effect.succeed({ ok: true }));
  const bareUniversalRtLoad = universal.load(() => Effect.succeed({ ok: true }));
  expectTypeOf<HandlerParams<typeof bareServerLoad>>().toEqualTypeOf<KitServerLoadParams>();
  expectTypeOf<HandlerParams<typeof bareAction>>().toEqualTypeOf<KitActionParams>();
  expectTypeOf<HandlerParams<typeof bareEndpoint>>().toEqualTypeOf<KitRequestHandlerParams>();
  expectTypeOf<HandlerParams<typeof bareUniversalLoad>>().toEqualTypeOf<KitLoadParams>();
  expectTypeOf<HandlerParams<typeof bareAdapterLoad>>().toEqualTypeOf<KitServerLoadParams>();
  expectTypeOf<HandlerParams<typeof bareServerRtLoad>>().toEqualTypeOf<KitServerLoadParams>();
  expectTypeOf<HandlerParams<typeof bareUniversalRtLoad>>().toEqualTypeOf<KitLoadParams>();

  // ── 1. each wrapper's param constraint mirrors SvelteKit's own ─────────────
  // (`infer` resolves a generic to its *constraint*; this catches a wrapper that
  // clamps tighter than SvelteKit — the failure mode in real projects whose
  // generated layout params are a partial/index-signature record.)
  expectTypeOf<WrapperParams<typeof serverLoad>>().toEqualTypeOf<KitServerLoadParams>();
  expectTypeOf<WrapperParams<typeof action>>().toEqualTypeOf<KitActionParams>();
  expectTypeOf<WrapperParams<typeof endpoint>>().toEqualTypeOf<KitRequestHandlerParams>();
  expectTypeOf<WrapperParams<typeof universalLoad>>().toEqualTypeOf<KitLoadParams>();
  expectTypeOf<WrapperParams<typeof adapter.serverLoad>>().toEqualTypeOf<KitServerLoadParams>();
  expectTypeOf<WrapperParams<typeof adapter.action>>().toEqualTypeOf<KitActionParams>();
  expectTypeOf<WrapperParams<typeof adapter.endpoint>>().toEqualTypeOf<KitRequestHandlerParams>();
  expectTypeOf<WrapperParams<typeof server.serverLoad>>().toEqualTypeOf<KitServerLoadParams>();
  expectTypeOf<WrapperParams<typeof server.action>>().toEqualTypeOf<KitActionParams>();
  expectTypeOf<WrapperParams<typeof universal.load>>().toEqualTypeOf<KitLoadParams>();

  // ── 2. wrappers accept SvelteKit's own base param type (no clamp) ──────────
  // A `LayoutServerLoad`-style annotation infers `Params` to SvelteKit's base;
  // the wrapper must accept it. This is the assignment that broke before.
  const layoutLoad: ServerLoad<KitServerLoadParams> = serverLoad(({ params }) => {
    expectTypeOf(params).toEqualTypeOf<KitServerLoadParams>();
    return Effect.succeed({ ok: true });
  });
  expectTypeOf(layoutLoad).toMatchTypeOf<ServerLoad<KitServerLoadParams>>();

  // ── 3. concrete-param routes (`[id]`) still infer precisely ───────────────
  const idLoad: ServerLoad<RouteParams> = serverLoad(({ params }) => {
    expectTypeOf(params).toEqualTypeOf<RouteParams>();
    return Effect.succeed({ id: params.id });
  });
  expectTypeOf(idLoad).toMatchTypeOf<ServerLoad<RouteParams>>();

  // ── 4. a root-layout shape (optional child params) annotates cleanly ──────
  // across every wrapper that takes a `Params` generic.
  const layoutServerLoad: ServerLoad<LayoutShape> = serverLoad(() => Effect.succeed({ ok: true }));
  const layoutAction: Action<LayoutShape> = action(() => Effect.succeed({ ok: true }));
  const layoutActions: Actions<LayoutShape> = actions({ save: () => Effect.succeed({ ok: true }) });
  const layoutEndpoint: RequestHandler<LayoutShape> = endpoint(() =>
    Effect.succeed(new Response()),
  );
  const layoutUniversal: Load<LayoutShape> = universalLoad(() => Effect.succeed({ ok: true }));
  expectTypeOf(layoutServerLoad).toMatchTypeOf<ServerLoad<LayoutShape>>();
  expectTypeOf(layoutAction).toMatchTypeOf<Action<LayoutShape>>();
  expectTypeOf(layoutActions).toMatchTypeOf<Actions<LayoutShape>>();
  expectTypeOf(layoutEndpoint).toMatchTypeOf<RequestHandler<LayoutShape>>();
  expectTypeOf(layoutUniversal).toMatchTypeOf<Load<LayoutShape>>();

  // Runtime-bound wrappers accept the same root-layout shape.
  const adapterLayout: ServerLoad<LayoutShape> = adapter.serverLoad(() =>
    Effect.succeed({ ok: true }),
  );
  const serverLayout: ServerLoad<LayoutShape> = server.serverLoad(() =>
    Effect.succeed({ ok: true }),
  );
  const universalLayout: Load<LayoutShape> = universal.load(() => Effect.succeed({ ok: true }));
  expectTypeOf(adapterLayout).toMatchTypeOf<ServerLoad<LayoutShape>>();
  expectTypeOf(serverLayout).toMatchTypeOf<ServerLoad<LayoutShape>>();
  expectTypeOf(universalLayout).toMatchTypeOf<Load<LayoutShape>>();
}

describe("route-param wrappers mirror SvelteKit's base param constraint", () => {
  // The substantive coverage is the type-level `typeChecks` body above, which
  // `vp check` type-checks. This runtime test only asserts it is wired up.
  it("type-checks (see typeChecks)", () => {
    expectTypeOf(typeChecks).toBeFunction();
  });
});
