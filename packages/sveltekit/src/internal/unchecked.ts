/**
 * The narrowings of this package that nothing can check, each a function with
 * the invariant its callers rely on. A type assertion is a lint error
 * everywhere else (`effect/casting-awareness`,
 * `typescript/no-unsafe-type-assertion`); the one override in the root
 * `vite.config.ts` names this file, so a new unchecked narrowing has to be
 * added here, with its reason.
 *
 * Universal: no `$app/*`, no `node:`.
 *
 * @internal
 */

import type { ActionFailure } from "@sveltejs/kit";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import type * as HttpRouter from "effect/http/HttpRouter";
import type { Catalogue, CatalogueEntry, Tagged } from "../errors.js";
import type { EnhanceHandlers, EnhanceHandlersBy } from "./enhance.js";

/**
 * An Effect, typed as requiring nothing more than the runtime it is about to
 * run on provides.
 *
 * An Effect's requirements exist only in its type, so there is nothing to
 * check at runtime: one that asks for a service its runtime lacks dies with
 * Effect's "Service not found" defect when it runs. The two callers, and why
 * the compiler cannot check them either:
 *
 * - the auto-wrappers (`internal/auto.ts`): the `effectKit()` plugin's
 *   generated code passes whatever the user's module exports, and which
 *   runtime module the app configured is not known where the wrapper is typed;
 * - `Forms.enhance` (`internal/enhance.ts`): its signature requires a runtime
 *   that provides the handlers' services, through a conditional type on its
 *   type parameters, which TypeScript does not resolve inside the function.
 */
export const assumeProvided = <A, E>(effect: Effect.Effect<A, E, unknown>): Effect.Effect<A, E> =>
  // SAFETY: see above; the requirements parameter is phantom, so the value is
  // unchanged and a missing service is a defect at run time.
  effect as Effect.Effect<A, E>;

/**
 * The `onError` of `Forms.enhance`'s handlers, typed as accepting every error
 * `onSubmit` and `onResult` fail with (`ESubmit | EResult`); `undefined` when
 * the handlers have none.
 *
 * `Forms.enhance`'s signature checks exactly that: the error `onError`
 * receives (`E`) is the union of the errors of the handlers present
 * (`OnErrorInput`), or an annotation checked against them (`OnErrorAccepts`).
 * Both are conditional types on the signature's type parameters, which
 * TypeScript does not resolve inside the function.
 */
export const onErrorOf = <RSubmit, RResult, RError, ESubmit, EResult, E>(
  handlers: EnhanceHandlersBy<RSubmit, RResult, RError, ESubmit, EResult, E>,
): EnhanceHandlers<RError, ESubmit, EResult>["onError"] =>
  // SAFETY: see above; the caller's signature has checked the error type.
  handlers.onError as EnhanceHandlers<RError, ESubmit, EResult>["onError"];

/**
 * An `Errors.toSvelteKit` catalogue as the translator reads it: by the `_tag`
 * of whatever error a failed `Cause` holds, each entry typed as accepting any
 * tagged error.
 *
 * Every key of a `Catalogue<E>` is one of `E`'s tags and its entry is typed
 * for the member of `E` with that tag; the translator calls an entry only with
 * an error whose `_tag` is the entry's key (what an entry may return,
 * `Returned`, is unchanged). That the error with that tag IS
 * that member is the caller's claim, made by passing its error union as `E`:
 * a failed `Cause` holds `unknown`, and a `_tag` is all a tagged error can be
 * checked for at runtime.
 */
export const catalogueEntries = <E extends Tagged, Returned extends ActionFailure<unknown>>(
  catalogue: Catalogue<E, Returned>,
): Readonly<Record<string, CatalogueEntry<Tagged, Returned>>> =>
  // SAFETY: see above; an entry is only applied to an error of its own tag.
  catalogue as Readonly<Record<string, CatalogueEntry<Tagged, Returned>>>;

/**
 * A normalised remote-function validator (the `"unchecked"` marker or a
 * Standard Schema), typed as the `"unchecked"` marker for SvelteKit's
 * `$app/server` helpers (`query`, `form`, `command`, `prerender`,
 * `query.batch`, `query.live`).
 *
 * Kit types those helpers as overloads, one per validator kind, and an
 * overload cannot be selected for a validator whose kind is only known at
 * runtime (`form`'s schema overload, moreover, takes a conditional parameter
 * type that does not resolve for a generic schema). At runtime kit handles
 * both kinds in one code path. The `"unchecked"` overload is the one whose
 * handler input is the type parameter this package's own overloads have
 * already tied to the validator's output, so the handler is typed correctly;
 * what it gives up is kit's typing of the remote function's INPUT, which this
 * package's overloads restate on the function they return.
 */
export const asUncheckedOverload = (validator: "unchecked" | StandardSchemaV1): "unchecked" =>
  // SAFETY: see above; kit accepts a Standard Schema wherever it accepts
  // the marker.
  validator as "unchecked";

/**
 * An `HttpApi`'s router layer, typed as requiring only the `HttpRouter` to
 * build: for `Endpoint.fromApi` (`server/Endpoint.ts`).
 *
 * Effect types the services an API group's handlers use as requirements of
 * the group's LAYER, as if building it needed them. Building it only
 * registers the routes; the handlers read their services when a request
 * runs. `Endpoint.fromApi` relies on that to supply request-scoped services
 * per dispatch (its `context` option) to a layer built once, which Effect's
 * types have no way to say. A handler that asks for a service neither the
 * layer nor the request's context provides dies with Effect's "Service not
 * found" defect.
 */
export const builtWithRouterOnly = <E>(
  layer: Layer.Layer<never, E, unknown>,
): Layer.Layer<never, E, HttpRouter.HttpRouter> =>
  // SAFETY: see above; the requirements parameter is phantom, so the layer is
  // unchanged.
  layer as Layer.Layer<never, E, HttpRouter.HttpRouter>;
