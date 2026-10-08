# TodoMVC — effect-svelte

The classic [TodoMVC](https://todomvc.com) app built with Svelte 5, Vite, and
[`@thomasfosterau/effect-svelte`](../../packages/svelte).

Todos are persisted to `localStorage` through an Effect service
(`TodoRepository`), and all reads/writes flow through Effect's reactivity
system, so every component stays in sync automatically.

## Run it

From the repository root:

```bash
pnpm install
pnpm run build           # builds every workspace package (vp run -r build)
cd examples/todomvc
pnpm run dev
```

## What it demonstrates

| API                                                 | Where                                                                         |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `provideRuntime`                                    | `src/App.svelte`                                                              |
| `SvelteRuntime.extend`                              | `src/lib/runtime.ts`                                                          |
| `useReactiveQuery` (dynamic + static keys)          | `src/lib/components/TodoApp.svelte`                                           |
| `useReactiveMutation`                               | `TodoApp.svelte`, `TodoHeader.svelte`, `TodoItem.svelte`, `TodoFooter.svelte` |
| `useInvalidateKeys`                                 | `TodoApp.svelte` (cross-tab sync via the `storage` event)                     |
| `AsyncResult` + `isSuccess`/`isFailure`/`isWaiting` | `TodoApp.svelte`, `TodoHeader.svelte`, `TodoItem.svelte`                      |
| Effect service + layer (`Context.Service`)          | `src/lib/todo-repository.ts`                                                  |
| Schema-based persistence                            | `src/lib/model.ts`, `src/lib/todo-repository.ts`                              |

## How it works

- `src/lib/runtime.ts` builds the app runtime with `SvelteRuntime.extend`,
  merging the `TodoRepository` layer with `Reactivity.layer` from
  `effect/reactivity`.
- `src/App.svelte` calls `provideRuntime(appRuntime)` once at the root.
- `TodoApp.svelte` declares two `useReactiveQuery`s over the repository — the
  visible (filtered) todos and the counts. Both depend on the `"todos"` key.
- Every mutation (`add`, `toggle`, `update`, `remove`, `toggleAll`,
  `clearCompleted`) is a `useReactiveMutation` keyed on `"todos"`: when it
  succeeds, both queries re-run automatically.
- Editing the list in a second browser tab fires the `storage` event, which
  calls the `useInvalidateKeys` invalidator to refresh this tab's queries.
