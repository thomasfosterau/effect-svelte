# Real-time Dashboard — effect-svelte

A simulated market dashboard built with Svelte 5, Vite, and
[`@thomasfosterau/effect-svelte`](../../packages/svelte), focused on the
**streaming and concurrency** side of the library: Effect Streams, PubSub,
SubscriptionRef, scopes, and fiber interruption.

Everything is simulated in the browser (random-walk prices, in-memory
portfolio), so the app works completely offline.

## Run it

From the repository root:

```bash
pnpm install
pnpm run build           # builds every workspace package (vp run -r build)
cd examples/realtime-dashboard
pnpm run dev
```

## What it demonstrates

| API                                                                 | Where                                                            |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `useStream`                                                         | `PriceTicker.svelte` (live quote streams), `SymbolSearch.svelte` |
| `useSubscriptionRef`                                                | `Portfolio.svelte` (portfolio state)                             |
| `usePubSub`                                                         | `TradeFeed.svelte` (executed trades)                             |
| `SignalEmitter` (Svelte → Effect)                                   | `SymbolSearch.svelte` (debounced lookups)                        |
| `useEffect` (manual run + interrupt)                                | `Connection.svelte` (interruptible ping)                         |
| `useScope` / `useScopeCallback`                                     | `Connection.svelte` (acquire/release on mount/unmount)           |
| `useDerived`                                                        | `QuoteCard.svelte` (re-runs on selection change)                 |
| `AsyncResult.match`                                                 | `QuoteCard.svelte`                                               |
| `useReactiveMutation` / `useReactiveStream`                         | `Portfolio.svelte` (trade → value history)                       |
| `getRuntime` (custom hooks)                                         | `lib/use-clock.svelte.ts`                                        |
| `provideRuntime` / `SvelteRuntime.extend`                           | `App.svelte`, `lib/runtime.ts`                                   |
| Effect services, `Random`, `Schedule`, `Stream` operators, `Result` | `lib/market.ts`, `lib/stores.ts`, components                     |

## How one trade exercises three reactive primitives

Pressing **Trade** in the portfolio panel runs a single `useReactiveMutation`
whose effect:

1. updates the portfolio inside a `SubscriptionRef` → the holdings table
   (`useSubscriptionRef`) updates;
2. publishes the executed trade to a `PubSub` → the trade feed (`usePubSub`)
   appends it;
3. invalidates the `"portfolio"` reactivity key → the value-history panel
   (`useReactiveStream`) recomputes the portfolio value.
