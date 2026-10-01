# Effect v4 × Svelte/SvelteKit — API opportunities review

> Status: review / proposal. Researched against the versions currently pinned in
> this repo: `effect@4.0.0-rc.118 (the review itself was written against beta.75)`, `svelte@5.56.1`, `@sveltejs/kit@2.61.1`.
> Signatures below were read from the installed `.d.ts` files, not from memory.

The goal of this document is to map the surface of Svelte 5 and SvelteKit
against what Effect v4 now ships natively, and to identify where this library
can offer **idiomatic, Effect-native** interfaces ahead of a first publication.

---

## TL;DR — the headline finding

Effect v4 absorbed the **Atom** reactive-state system into core, under
`effect/reactivity`:

| Module                    | What it is                                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AsyncResult`             | A first-class `Initial \| Success \| Failure` result type, each state carrying a `waiting` flag (stale-while-revalidate) and a previous value. Has a `Schema`. |
| `Atom` / `AtomRegistry`   | The atom primitive + a registry with `get` / `set` / `subscribe` / `mount` / `refresh`.                                                                        |
| `Atom.runtime(layer)`     | Builds an `AtomRuntime` so atoms can use your `Layer` services (`Atom.fn`, `Atom.pull`, …).                                                                    |
| `AtomRef`                 | Fine-grained, prop-level reactive references.                                                                                                                  |
| `Hydration`               | `dehydrate` / `hydrate` a registry — i.e. SSR.                                                                                                                 |
| `AtomHttpApi` / `AtomRpc` | Typed HttpApi/Rpc clients exposed as atoms.                                                                                                                    |

The Effect org publishes **framework bindings** for this system:
`@effect/atom-react`, `@effect/atom-solid`, `@effect/atom-vue`. **There is no
Svelte binding.** The binding pattern is small and maps almost perfectly onto
Svelte 5's `createSubscriber` (added in 5.7):

```ts
// the entire core of an idiomatic Svelte atom binding
import { createSubscriber } from "svelte/reactivity";

function useAtomValue<A>(atom: Atom.Atom<A>): { readonly current: A } {
  const registry = getRegistry(); // from Svelte context
  const subscribe = createSubscriber(
    (update) => registry.subscribe(atom, update), // -> returns unsubscribe
  );
  return {
    get current() {
      subscribe(); // registers reactive dep
      return registry.get(atom);
    },
  };
}
```

Compare the Solid binding's `createAtomAccessor`
(`packages/atom/solid/src/Hooks.ts`) — it is the same shape with
`createSignal`/`createComputed` instead of `createSubscriber`.

**Recommendation:** position the package as _the_ Svelte binding for Effect's
Atom system (the de-facto `@effect/atom-svelte`), and align the bespoke hooks
with the native `AsyncResult`. This is the single change that makes the library
feel "Effect v4 native" rather than "a hand-rolled Effect/Svelte bridge", and it
inherits HttpApi/Rpc/SSR for free.

The rest of this document is the detailed opportunity list, tiered by impact.

---

## Where the library is today

Svelte (`packages/svelte/src/`): `provideRuntime`/`getRuntime`, `SvelteRuntime`,
`useScope(Callback)`, `useEffect`, `useStream`, `useDerived`, `useQuery`,
`useSubscriptionRef`, `usePubSub`, `reactiveQuery`/`reactiveStream`/
`reactiveMutation`/`useInvalidateKeys` (built on the older
`unstable/reactivity/Reactivity`), `SignalEmitter`, and a bespoke
`AsyncResult` (`initial | pending | success | failure`).

SvelteKit (`packages/sveltekit/src/`): universal `load` + `makeUniversalRuntime`; server
`serverLoad`/`action`/`actions`/`handle`/`endpoint` + `makeServerRuntime`;
`SvelteKitRuntime`/`SvelteKitRequestEvent`; remote functions
(`query`/`queryBatch`/`queryLive`/`form`/`command`/`prerender`) and
`call*` helpers; the `effectKit()` Vite plugin; and the `effectAdapter()` Effect
HTTP deployment adapter.

This is already a broad, well-tested surface. The opportunities below are about
**alignment with v4 idioms** and **closing specific Svelte/SvelteKit API gaps**,
not about filling holes in what already exists.

---

## Tier 1 — strategic / highest leverage

> **Decision (2026-06):** the maintainer has an open PR adding an official
> `@effect/atom-svelte` package to the Effect repo. To avoid shipping a binding
> that is about to be superseded, **this library will not build its own atom
> hooks** (former item 2 below). Instead it adopts the native `AsyncResult` so
> its types interoperate with that package, and will document `@effect/atom-svelte`
> as the primary atom path once it lands. Items 1 and 3 are **implemented** (see
> `packages/svelte/src/`).

### 1. Adopt the native `AsyncResult` (`effect/reactivity/AsyncResult`) — ✅ done

The library defines its own four-state union. The native type is a three-state
union where `Initial`/`Success`/`Failure` _each_ carry `waiting: boolean` and a
reference to the previous value:

```ts
type AsyncResult<A, E> = Initial<A, E> | Success<A, E> | Failure<A, E>;
// + isWaiting, fromExit, fromExitWithPrevious, value, getOrElse, match,
//   matchWithWaiting, map, flatMap, all, builder, Schema, ...
```

Why it matters:

- `waiting` enables **stale-while-revalidate** UI (show last value while
  refetching) — the bespoke `pending` tag throws away the previous value, so
  every refetch flashes a spinner. This is the single most visible UX win.
- It comes with `AsyncResult.Schema`, so a result can cross the
  server→client boundary (load/remote/transport).
- Every framework binding speaks this type, so examples and mental models
  transfer.

Migration: re-export the native module (`export * as AsyncResult from
"effect/reactivity/AsyncResult"`), keep thin `match`/guard wrappers for
ergonomics, and have `useEffect`/`useDerived`/`useStream` produce the native shape.
The current bespoke `match(result, {initial, pending, success, failure})` becomes
`AsyncResult.match` / `matchWithWaiting`. This is a breaking change — best done
**before** 0.1.0 while there are no external consumers.

### 2. Svelte Atom binding — superseded by official `@effect/atom-svelte` (not building here)

> Superseded: an official `@effect/atom-svelte` package is in progress upstream.
> The sketch below is retained only to document the intended shape and to confirm
> that adopting the native `AsyncResult` (item 1) keeps this library compatible
> with it. **No atom hooks ship from this package.**

Mirror the Solid/React/Vue hook surface using runes. Intended exports:

| Export                               | Returns              | Notes                                                                                                  |
| ------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------ |
| `setRegistry` / `getRegistry`        | —                    | Svelte-context registry (`AtomRegistry.make()`), defaulting to a global. Use Svelte 5 `createContext`. |
| `useAtomValue(atom)`                 | `{ current }`        | `createSubscriber` + `registry.get`.                                                                   |
| `useAtom(atom)`                      | `[{ current }, set]` | value + writer.                                                                                        |
| `useAtomSet(atom, {mode})`           | setter               | `mode: "value" \| "promise" \| "promiseExit"` like the Solid binding.                                  |
| `useAtomRefresh(atom)`               | `() => void`         | mounts + refresh.                                                                                      |
| `useAtomMount(atom)`                 | —                    | keep mounted for component lifetime.                                                                   |
| `useAtomRef(ref)` / `useAtomRefProp` | `{ current }`        | prop-level `AtomRef`.                                                                                  |
| `useAtomInitialValues(values)`       | —                    | SSR seeding.                                                                                           |

Because Svelte tracks reads through getters, `useAtomValue` can return a getter
object usable directly in markup and inside `$derived`. The whole binding is a
few hundred lines and leans on Svelte's own dependency tracking rather than
manual `$effect` + fiber bookkeeping.

Bonus once atoms are in place: `AtomHttpApi.Service(...)` and `AtomRpc` give
fully-typed remote clients as atoms with zero extra binding code — a strong
SvelteKit story.

### 3. Rebuild the reactive subscriptions on `createSubscriber` — ✅ done

Independently of atoms, `useSubscriptionRef`, `usePubSub`, and `useStream`
currently wire `$state` + `$effect` + a fiber by hand. `createSubscriber`
(Svelte ≥ 5.7, already satisfied by the `^5.40.0` peer) is the idiomatic
primitive for "external push source → rune", and gives correct multi-reader
sharing and teardown semantics for free:

```ts
export function useSubscriptionRef<A>(ref: SubscriptionRef.SubscriptionRef<A>) {
  const runtime = getRuntime();
  let value = runSync(runtime)(SubscriptionRef.get(ref));
  const subscribe = createSubscriber((update) =>
    runFork(runtime)(
      Stream.runForEach(SubscriptionRef.changes(ref), (v) =>
        Effect.sync(() => {
          value = v;
          update();
        }),
      ),
    ).pipe(/* cleanup: interrupt on teardown */),
  );
  return {
    get current() {
      subscribe();
      return value;
    },
  };
}
```

This is a non-breaking internal change that also tightens the
`reactiveQuery`/`reactiveStream` implementations (which currently mutate a
`$state` proxy in place and need the `assignResult` `untrack` dance).

---

## Tier 2 — SvelteKit gaps worth closing

### 4. `transport` hook ⇄ Effect Schema

SvelteKit 2.11+ has a universal `transport` hook for moving custom types across
the server/client boundary (used by `load` data **and** remote functions):

```ts
export type Transport = Record<string, Transporter>;
export interface Transporter<T, U> {
  encode: (value: T) => false | U; // server
  decode: (data: U) => T; // client
}
```

A `Transporter` is exactly an Effect `Schema` codec. We can offer:

```ts
// build a transporter from a Schema (+ an instanceof/refinement guard)
transporter(schema, isInstance): Transporter
// build a whole `transport` object from a record of schemas
transport({ Option: …, DateTime: …, MyError: … }): Transport
```

This lets `Option`, `DateTime`, branded types, and `Schema.TaggedError`s flow
through `load`/remote results without hand-written (de)serialization — a
genuinely Effect-native capability nothing else provides. `AsyncResult.Schema`
plus this hook means an atom's result can round-trip for SSR hydration.

### 5. `$env` ⇄ Effect `Config` provider

SvelteKit exposes config via `$env/static/*` and `$env/dynamic/*`. Effect apps
want a `ConfigProvider`. Provide a layer that backs `Config` with SvelteKit env:

```ts
// reads from $env/dynamic/private (or a supplied record)
export const sveltekitConfigProvider = (env: Record<string, string | undefined>) =>
  ConfigProvider.fromEnv({ env }); // + ConfigProvider.layer(...)
```

Then `makeServerRuntime(layer.pipe(Layer.provide(envConfig)))` and any
`Config.String("DATABASE_URL")` resolves from SvelteKit's env. Small, but it's
the missing link that makes `Config`-driven services "just work" in SvelteKit.

### 6. `reroute` and `transport` in the Vite auto-plugin + explicit wrappers

`hooks.server.ts`/`hooks.(server|client).ts` can export `reroute`
(`(event) => MaybePromise<void|string>`) and `transport`. The auto-plugin's
`wrapperByKind` currently covers `handle`/`handleFetch`/`handleError`/`init`
only. `reroute` is a natural Effect wrapper (it's a pure-ish async function);
`transport` would be passed through (it's data, not an Effect). Add explicit
`reroute()` wrapper + plugin coverage so the "write your hooks as Effects" story
is complete.

### 7. `$app/navigation` as Effects and Streams — ✅ done

`goto`, `invalidate`, `invalidateAll`, `refreshAll`, `preloadData`,
`preloadCode` are `Promise`-returning — wrapped as `Effect` under the
`Navigation` namespace (client-only subpath):

```ts
goto(url, opts): Effect<void>          // Effect.promise wrappers
invalidate(resource): Effect<void>
preloadData(href): Effect<{type; …}>
```

`beforeNavigate` / `onNavigate` / `afterNavigate` are subscription callbacks —
expose them as `Stream`s so navigation can drive Effect pipelines. **✅ shipped**
in `@thomasfosterau/effect-sveltekit/client` under the `Navigation` namespace:
`Navigation.beforeNavigate()` / `Navigation.afterNavigate()` return `Stream`s,
and `Navigation.onNavigate(fn)` runs a (cleanup-returning) Effect per
navigation (the promise-returning `goto`/`invalidate`/… Effect wrappers live in
the same namespace).

### 8. `$app/state` (`page`, `navigating`, `updated`) bridges

`$app/state` replaced `$app/stores` with rune-based values. They're already
reactive, so the value-add is **Effect-side access**: `Stream`s of page changes.
**✅ partially shipped** — `State.page()` (in `…/client`) emits a snapshot of the
current `page` initially and after each navigation. A richer `CurrentPage`
service and `navigating`/`updated` streams remain future work (tracked in
issue #20's follow-ups), likely composing with `@effect/atom-svelte` (#23).

---

## Tier 3 — smaller, ecosystem-niceties

- **Store interop** (`svelte/store`). **✅ shipped** as the `Store` namespace in
  `@thomasfosterau/effect-svelte`: `Store.toStream(store)` for Svelte → Effect,
  and `Store.fromStream` / `Store.fromSubscriptionRef` / `Store.fromPubSub` /
  `Store.fromQueue` / `Store.fromRef` for surfacing Effect sources as Svelte
  readable stores.
- **`SvelteMap`/`SvelteSet`/`SvelteDate`** mention in docs as the reactive
  collections to use alongside Effect data — no code needed, but a
  `MediaQuery`→`Stream` example is a nice cookbook entry. (Still open.)
- **Remote `RemoteQuery`/`RemoteLiveQuery` reactive bridge.** **✅ shipped**:
  `useRemoteQuery(q)` exposes a reactive remote resource as an
  `AsyncResult` via its `.current`, and `Remote.liveQueryStream(q)` turns a
  `query.live(...)` (`AsyncIterable`) into a `Stream`.
- **`SignalEmitter` → align with atoms.** Once `@effect/atom-svelte` lands, the
  Svelte→Effect direction is "write into a writable atom"; keep `SignalEmitter`
  but document the atom path as primary. (Still open — see #23.)

---

## Pre-publication hygiene (independent of features)

- **Naming consistency.** Mixed `useX` (React-ish) vs `useDerived`/`reactiveX`.
  Pick one convention before 0.1.0 (suggest: keep `useX` for hooks that take an
  argument and return a handle). The `derived` hook was renamed to `useDerived`
  to avoid confusion with Svelte's `derived` store and `$derived` rune.
- **`AsyncResult` export collision.** ✅ Resolved: the bespoke type was removed
  and the native `effect/reactivity/AsyncResult` is re-exported as the
  `AsyncResult` namespace.
- **`client.ts` placeholder.** ✅ Resolved: `…/client` now exports the
  `Navigation` / `State` / `Remote` namespaces, `useRemoteQuery`, etc.
- **Effect Schema for remote validators.** Document that
  `Schema.toStandardSchemaV1(schema)` plugs straight into the remote
  `query`/`form`/`command` schema slot (the code already detects `~standard`),
  so users get Effect-Schema-validated remote functions today.
- **README "idiomatic" examples.** ✅ The README leads with a
  stale-while-revalidate `AsyncResult` example (the atom example is deferred to
  the upstream `@effect/atom-svelte` package).
- **Changesets.** ✅ Consolidated into one initial-release entry per package
  (`@thomasfosterau/effect-svelte`, `@thomasfosterau/effect-sveltekit`), with
  the private example apps ignored so a release bumps only the two packages.

---

## Suggested phasing

1. **0.1.0 foundations (breaking, do first):** adopt native `AsyncResult`;
   rebuild subscriptions on `createSubscriber`; converge result accessors on
   `.current`. **✅ implemented.**
2. ~~Atom binding~~ — **dropped**; superseded by the official
   `@effect/atom-svelte` package. Adopting the native `AsyncResult` in (1) is
   what keeps this library interoperable with it.
3. **SvelteKit completeness** — ✅ done: `transport`⇄Schema, `$env`⇄Config,
   `reroute` wrapper + plugin coverage, `$app/navigation` effects/streams, and
   the remote-query reactive bridge.
4. **Polish** — ✅ mostly done: the `Store` namespace interop and the `State.page`
   stream shipped; the `SvelteMap`/`SvelteSet` cookbook and a richer `$app/state`
   service remain open (and may compose with `@effect/atom-svelte`).

Items in (1) are breaking and cheap, so they landed first; (2) is deferred to
the upstream atom package; (3) and most of (4) shipped across the 0.1.0 PRs.
