---
"@thomasfosterau/effect-sveltekit": patch
---

Widen route-param generics so partial (layout) params annotate cleanly.

The server/universal wrappers (`serverLoad`, `action`, `actions`, `endpoint`,
the universal `load`, and the `RuntimeAdapter` / `ServerRuntime` /
`UniversalRuntime` equivalents) hardcoded `Params extends Record<string, string>
= any`. That was both more restrictive than SvelteKit's own handler types — whose
base param constraint is the generated `LayoutParams<'/'>`, a partial record for a
root `+layout` (e.g. `{ type?: string; id?: string }`) — and defaulted `Params`
to `any`, dropping param typing. As a result a partial-param root
`+layout.server.ts` could not be given an explicit `: LayoutServerLoad`
annotation, and consumers kept a local type-shim.

The wrappers now mirror SvelteKit's base param constraint, so they accept exactly
what SvelteKit accepts: a root-layout `: LayoutServerLoad` annotation type-checks,
and concrete-param routes (`[id]`) still infer precisely.

This is type-only and backward compatible; runtime behaviour is unchanged.
