---
"@thomasfosterau/effect-svelte": minor
---

Migrate to Effect v4 (beta).

The package now targets `effect@4.0.0-beta.x`. In Effect v4 the ecosystem
shares a single version number and most packages were merged into `effect`
itself, which changes this package's peer dependencies:

- **`effect`**: requires `^4.0.0-beta.75`
- **`@effect/platform`**: no longer required (removed from peer dependencies).
  Its modules now live inside `effect` — HTTP under `effect/unstable/http/*`,
  `FileSystem` / `Path` under `effect/*`.
- **`@effect/platform-node`**: requires `^4.0.0-beta.75` (optional; only needed
  for the deployment adapter). Keep it on the same beta version as `effect`.
- **`@effect/experimental`**: no longer required (removed from peer
  dependencies). `Reactivity` now lives at `effect/unstable/reactivity`.

Public API is unchanged, with one exception driven by v4 itself:

- `RuntimeLike<R>` (accepted by `provideRuntime` and the runes hooks) is now
  `Context.Context<R> | ManagedRuntime<R, never>` — Effect v4 removed the
  `Runtime.Runtime<R>` type. Code that passed `Runtime.defaultRuntime` should
  pass `Context.empty()` (or just use the default `SvelteRuntime`).

Internal changes follow the official v3→v4 migration: `Context.Tag` →
`Context.Service`, `Mailbox` → `Queue`, `Stream.async` → `Stream.callback`,
`Effect.catchAll*` → `Effect.catch*`, `HttpApp` → HTTP response effects,
`Layer.unwrapEffect` → `Layer.unwrap`, `Config.integer` → `Config.int`, and
`Schema.standardSchemaV1` → `Schema.toStandardSchemaV1`.
