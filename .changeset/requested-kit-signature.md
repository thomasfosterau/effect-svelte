---
"@thomasfosterau/effect-sveltekit": minor
---

`RemoteFunction.requested` now has the signature of the `$app/server` function it passes through (`typeof requested`), in place of `<Result = unknown>(...args: unknown[]) => Result`: the result is typed from the query, as SvelteKit types it, and is no longer chosen by the caller.

- `RemoteFunction.requested<MyResult>(getPost, 5)` with a result type argument no longer compiles: drop the type argument (`RemoteFunction.requested(getPost, 5)`), and the entries are typed from `getPost`.
- A call with no type argument, which used to return `unknown`, now returns SvelteKit's `RemoteQueryRequestedResult` (or `RemoteLiveQueryRequestedResult` for a `query.live`), so code that narrowed or asserted the `unknown` can lose the assertion.
- The arguments are checked as SvelteKit checks them: a `query` (or `query.live`) function and a `limit`.

Runtime behaviour is unchanged: the call goes to SvelteKit's `requested`, and still throws a `RemoteFunctionUsageError` on a SvelteKit version without it.
