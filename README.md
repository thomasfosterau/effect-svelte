# @thomasfosterau/effect-svelte

A library for seamless interoperation between [Effect](https://effect.website/) and [Svelte](https://svelte.dev/) / [SvelteKit](https://kit.svelte.dev/). This library provides helpers to:
1. Wrap Effect-based code for use in SvelteKit's load functions, actions, endpoints, and hooks
2. Create reactive Svelte 5 components that integrate with Effect-TS using runes

## Installation

```bash
npm install @thomasfosterau/effect-svelte effect svelte @sveltejs/kit
```

## Features

### SvelteKit Integration
- 🔄 **Load Functions**: Wrap Effect code for both server and universal load functions
- ⚡ **Actions**: Convert Effect-based logic into SvelteKit form actions
- 🌐 **Endpoints**: Use Effect in API route handlers
- 🪝 **Hooks**: Integrate Effect into SvelteKit hooks

### Svelte 5 Runes Integration
- 🎯 **Runtime Context**: Provide Effect runtime via Svelte context
- 🔄 **Lifecycle Management**: Scope primitive tied to component lifecycle
- 🚀 **Core Runners**: Reactive hooks for Effect and Stream
- 💡 **Convenience Hooks**: Query pattern, derived effects, and subscriptions
- 🌊 **Bidirectional**: Bridge Svelte reactivity to Effect streams

All features are:
- 💪 **Type-safe**: Full TypeScript support with proper type inference
- 🎯 **Error Handling**: Automatic Effect error handling with Cause preservation
- 📦 **Modular**: Clean, organized API with layered architecture

## Usage

The library provides two entry points:
- `@thomasfosterau/effect-svelte` - Universal adapters + Svelte 5 runes integration
- `@thomasfosterau/effect-svelte/server` - Server-only adapters

### Server Load Functions

Use `SvelteKit.load` from the `/server` export for server-side load functions:

```typescript
// src/routes/+page.server.ts
import { SvelteKit } from '@thomasfosterau/effect-svelte/server';
import { Effect } from 'effect';

export const load = SvelteKit.load((event) =>
  Effect.gen(function* () {
    // Your Effect-based logic here
    const userId = event.params.id;
    const user = yield* fetchUser(userId);
    return { user };
  })
);
```

### Universal Load Functions

Use `SvelteKit.load` from the main export for universal (client + server) load functions:

```typescript
// src/routes/+page.ts
import { SvelteKit } from '@thomasfosterau/effect-svelte';
import { Effect } from 'effect';

export const load = SvelteKit.load((event) =>
  Effect.gen(function* () {
    const data = yield* processData();
    return { data };
  })
);
```

### Form Actions

Use `SvelteKit.action` for individual actions or `SvelteKit.actions` for multiple actions:

```typescript
// src/routes/+page.server.ts
import { SvelteKit } from '@thomasfosterau/effect-svelte/server';
import { Effect } from 'effect';

// Single action
export const actions = {
  default: SvelteKit.action((event) =>
    Effect.gen(function* () {
      const formData = yield* Effect.promise(() => event.request.formData());
      const email = formData.get('email');
      yield* sendEmail(email);
      return { success: true };
    })
  )
};

// Multiple actions
export const actions = SvelteKit.actions({
  create: (event) =>
    Effect.gen(function* () {
      const formData = yield* Effect.promise(() => event.request.formData());
      yield* createItem(formData);
      return { created: true };
    }),
  
  delete: (event) =>
    Effect.gen(function* () {
      const formData = yield* Effect.promise(() => event.request.formData());
      yield* deleteItem(formData);
      return { deleted: true };
    })
});
```

### API Endpoints

Use `SvelteKit.endpoint` to create Effect-based API route handlers:

```typescript
// src/routes/api/users/+server.ts
import { SvelteKit } from '@thomasfosterau/effect-svelte/server';
import { Effect } from 'effect';
import { json } from '@sveltejs/kit';

export const GET = SvelteKit.endpoint((event) =>
  Effect.gen(function* () {
    const users = yield* fetchUsers();
    return json(users);
  })
);

export const POST = SvelteKit.endpoint((event) =>
  Effect.gen(function* () {
    const data = yield* Effect.promise(() => event.request.json());
    const user = yield* createUser(data);
    return json(user, { status: 201 });
  })
);
```

### Hooks

Use `SvelteKit.handle` to integrate Effect into SvelteKit hooks:

```typescript
// src/hooks.server.ts
import { SvelteKit } from '@thomasfosterau/effect-svelte/server';
import { Effect } from 'effect';

export const handle = SvelteKit.handle(({ event, resolve }) =>
  Effect.gen(function* () {
    // Pre-processing with Effect
    const startTime = Date.now();
    
    // Resolve the request
    const response = yield* Effect.promise(() => resolve(event));
    
    // Post-processing with Effect
    const duration = Date.now() - startTime;
    console.log(`Request took ${duration}ms`);
    
    return response;
  })
);
```

## Error Handling

All helpers automatically handle Effect failures. By default:

- Load functions and actions throw errors that SvelteKit can catch
- Endpoints return a 500 response with error details in JSON format

Error messages preserve Effect's structured error information using `Cause.pretty()` for better debugging.

You can customize error handling by wrapping your Effect code with error recovery:

```typescript
import { Effect } from 'effect';

export const load = SvelteKit.load((event) =>
  Effect.gen(function* () {
    const data = yield* fetchData().pipe(
      Effect.catchAll((error) => 
        Effect.succeed({ data: null, error: error.message })
      )
    );
    return data;
  })
);
```

## TypeScript

All functions are fully typed and provide proper type inference for parameters and return values. The types align with SvelteKit's native types.

---

## Svelte 5 Runes Integration

The library provides a complete integration layer between Effect-TS and Svelte 5's runes system, enabling reactive components that seamlessly work with Effect programs.

### Architecture

The integration is built in layers, where each layer builds upon the previous:

- **Layer 0**: Runtime context provision
- **Layer 1**: Scope primitive (lifecycle management)
- **Layer 2**: Core runners (Effect and Stream adapters)
- **Layer 3**: Convenience hooks and utilities

### Core Types

```typescript
type AsyncResult<A, E> =
  | { readonly _tag: 'initial' }
  | { readonly _tag: 'pending' }
  | { readonly _tag: 'success'; readonly value: A }
  | { readonly _tag: 'failure'; readonly cause: Cause<E> };
```

### Layer 0: Runtime Context

Provide the Effect runtime at the root of your component tree:

```svelte
<!-- App.svelte -->
<script lang="ts">
  import { provideRuntime } from '@thomasfosterau/effect-svelte';
  import { Runtime } from 'effect';

  // Provide runtime to all child components
  provideRuntime(Runtime.defaultRuntime);
</script>

<YourApp />
```

### Layer 2: Core Runners

#### useEffect - Run a Single Effect

Run an Effect and track its result state:

```svelte
<script lang="ts">
  import { useEffect } from '@thomasfosterau/effect-svelte';
  import { Effect, Cause } from 'effect';

  const { result, run, interrupt } = useEffect(
    Effect.delay(Effect.succeed(42), '1 second'),
    { immediate: true }
  );
</script>

{#if result._tag === 'pending'}
  <p>Loading...</p>
{:else if result._tag === 'success'}
  <p>Result: {result.value}</p>
  <button onclick={run}>Run Again</button>
{:else if result._tag === 'failure'}
  <p>Error: {Cause.pretty(result.cause)}</p>
{/if}
```

#### useStream - Subscribe to a Stream

Subscribe to an Effect Stream and collect emissions:

```svelte
<script lang="ts">
  import { useStream } from '@thomasfosterau/effect-svelte';
  import { Stream, Schedule } from 'effect';

  const counter = useStream(
    Stream.iterate(0, n => n + 1).pipe(
      Stream.schedule(Schedule.spaced('1 second'))
    )
  );
</script>

<p>Latest: {counter.latest}</p>
<p>All values: {counter.values.join(', ')}</p>
```

### Layer 3: Convenience Hooks

#### derived - Reactive Effect

Re-run an effect whenever reactive dependencies change:

```svelte
<script lang="ts">
  import { derived } from '@thomasfosterau/effect-svelte';
  import { Effect } from 'effect';

  let userId = $state(1);

  // Effect re-runs automatically when userId changes
  const user = derived(() => 
    Effect.gen(function* () {
      const data = yield* fetchUser(userId);
      return data;
    })
  );
</script>

<button onclick={() => userId++}>Next User</button>

{#if user._tag === 'success'}
  <p>User: {user.value.name}</p>
{/if}
```

#### useQuery - Query Pattern

Run a query with manual refetch capability:

```svelte
<script lang="ts">
  import { useQuery } from '@thomasfosterau/effect-svelte';
  import { Effect } from 'effect';

  const query = useQuery(
    Effect.gen(function* () {
      const data = yield* fetchData();
      return data;
    })
  );
</script>

<button onclick={query.refetch}>Refresh</button>

{#if query.result._tag === 'success'}
  <pre>{JSON.stringify(query.result.value, null, 2)}</pre>
{/if}
```

#### useSubscriptionRef - Subscribe to SubscriptionRef

```svelte
<script lang="ts">
  import { useSubscriptionRef } from '@thomasfosterau/effect-svelte';
  
  // Assume counterRef is a SubscriptionRef<number>
  const count = useSubscriptionRef(counterRef);
</script>

<p>Count: {count}</p>
```

#### usePubSub - Subscribe to PubSub

```svelte
<script lang="ts">
  import { usePubSub } from '@thomasfosterau/effect-svelte';
  
  // Assume messagePubSub is a PubSub<string>
  const messages = usePubSub(messagePubSub);
</script>

<p>Latest: {messages.latest}</p>
<ul>
  {#each messages.values as msg}
    <li>{msg}</li>
  {/each}
</ul>
```

### Svelte → Effect: SignalEmitter

Bridge Svelte reactive state to Effect streams:

```svelte
<script lang="ts">
  import { SignalEmitter } from '@thomasfosterau/effect-svelte';
  import { Stream } from 'effect';

  let count = $state(0);
  const emitter = new SignalEmitter<number>();

  // Emit reactive values into the stream
  $effect(() => {
    emitter.emit(count);
  });

  // Now use emitter.stream in Effect pipelines
  const doubled = useStream(
    emitter.stream.pipe(
      Stream.map(n => n * 2)
    )
  );
</script>

<button onclick={() => count++}>Increment</button>
<p>Original: {count}, Doubled: {doubled.latest}</p>
```

### Utility Functions

Type guards for working with `AsyncResult`:

```typescript
import { isInitial, isPending, isSuccess, isFailure, match } from '@thomasfosterau/effect-svelte';
import { Cause } from 'effect';

// Type guards
if (isSuccess(result)) {
  console.log(result.value); // Type-safe access
}

// Pattern matching
const message = match(result, {
  initial: () => 'Not started',
  pending: () => 'Loading...',
  success: (value) => `Result: ${value}`,
  failure: (cause) => `Error: ${Cause.pretty(cause)}`
});
```

### Complete Example

```svelte
<script lang="ts">
  import { 
    provideRuntime, 
    useEffect, 
    useStream, 
    derived 
  } from '@thomasfosterau/effect-svelte';
  import { Effect, Stream, Schedule, Runtime, Cause } from 'effect';

  // Provide runtime (typically done at app root)
  provideRuntime(Runtime.defaultRuntime);

  // Simple effect with manual triggering
  const greeting = useEffect(
    Effect.succeed('Hello, Effect!'),
    { immediate: true }
  );

  // Stream with automatic updates
  const timer = useStream(
    Stream.iterate(0, n => n + 1).pipe(
      Stream.schedule(Schedule.spaced('1 second'))
    )
  );

  // Reactive effect tied to component state
  let searchTerm = $state('');
  const searchResults = derived(() =>
    searchTerm.length > 0
      ? Effect.gen(function* () {
          const results = yield* performSearch(searchTerm);
          return results;
        })
      : Effect.succeed([])
  );
</script>

<div>
  <h2>Greeting</h2>
  {#if greeting.result._tag === 'success'}
    <p>{greeting.result.value}</p>
  {/if}

  <h2>Timer</h2>
  <p>Elapsed: {timer.latest} seconds</p>

  <h2>Search</h2>
  <input bind:value={searchTerm} placeholder="Search..." />
  {#if searchResults._tag === 'success'}
    <ul>
      {#each searchResults.value as result}
        <li>{result}</li>
      {/each}
    </ul>
  {:else if searchResults._tag === 'pending'}
    <p>Searching...</p>
  {/if}
</div>
```

---

## Effect Reactivity Integration (@effect/experimental)

The library provides deep integration with `@effect/experimental`'s Reactivity module, enabling automatic cache invalidation and reactive queries similar to libraries like TanStack Query but fully integrated with Effect.

### Installation

```bash
npm install @effect/experimental
```

### Setup

Provide a runtime with the Reactivity layer:

```svelte
<!-- App.svelte -->
<script lang="ts">
  import { Svelte } from '@thomasfosterau/effect-svelte';
  import { Runtime } from 'effect';
  import { Reactivity } from '@effect/experimental';

  const runtime = Runtime.make(Reactivity.layer);
  Svelte.provideRuntime(runtime);
</script>

<YourApp />
```

### Reactive Query

Automatically re-runs when keys are invalidated:

```svelte
<script lang="ts">
  import { Svelte } from '@thomasfosterau/effect-svelte';
  import { Effect } from 'effect';

  let userId = $state(1);

  // This query depends on the 'user' key with the current userId
  const user = Svelte.reactiveQuery(
    () => ['user', userId],
    () => Effect.gen(function* () {
      const data = yield* fetchUser(userId);
      return data;
    })
  );
</script>

{#if user._tag === 'success'}
  <p>User: {user.value.name}</p>
{:else if user._tag === 'pending'}
  <p>Loading...</p>
{/if}
```

### Reactive Mutation

Invalidates keys after completion:

```svelte
<script lang="ts">
  import { Svelte } from '@thomasfosterau/effect-svelte';
  import { Effect } from 'effect';

  let userId = $state(1);

  const updateUser = Svelte.reactiveMutation(
    () => ['user', userId],
    () => Effect.gen(function* () {
      yield* updateUserInDB(userId, newData);
      return { success: true };
    })
  );

  function handleUpdate() {
    updateUser.run(); // Automatically invalidates ['user', userId]
  }
</script>

<button onclick={handleUpdate}>Update User</button>

{#if updateUser.result._tag === 'success'}
  <p>Updated successfully!</p>
{/if}
```

### Reactive Stream

Stream that emits when keys are invalidated:

```svelte
<script lang="ts">
  import { Svelte } from '@thomasfosterau/effect-svelte';
  import { Effect } from 'effect';

  const messages = Svelte.reactiveStream(
    ['messages'], // Keys to watch
    Effect.gen(function* () {
      const data = yield* fetchMessages();
      return data;
    })
  );
</script>

<ul>
  {#each messages.values as msg}
    <li>{msg}</li>
  {/each}
</ul>
```

### Manual Invalidation

Trigger re-queries manually:

```svelte
<script lang="ts">
  import { Svelte } from '@thomasfosterau/effect-svelte';

  function handleRefresh() {
    // This will re-run all queries depending on these keys
    Svelte.invalidateKeys(['users', 'messages']);
  }
</script>

<button onclick={handleRefresh}>Refresh All</button>
```

### Complete Example with Reactivity

```svelte
<script lang="ts">
  import { Svelte } from '@thomasfosterau/effect-svelte';
  import { Effect, Runtime } from 'effect';
  import { Reactivity } from '@effect/experimental';

  // Setup runtime with Reactivity
  const runtime = Runtime.make(Reactivity.layer);
  Svelte.provideRuntime(runtime);

  // Reactive state
  let searchTerm = $state('');

  // Reactive query - automatically re-runs when keys are invalidated
  const results = Svelte.reactiveQuery(
    () => ['search', searchTerm],
    () => Effect.gen(function* () {
      if (!searchTerm) return [];
      const data = yield* searchAPI(searchTerm);
      return data;
    })
  );

  // Mutation that invalidates the search results
  const clearCache = Svelte.reactiveMutation(
    () => ['search', searchTerm],
    () => Effect.succeed({ cleared: true })
  );
</script>

<input bind:value={searchTerm} placeholder="Search..." />
<button onclick={() => clearCache.run()}>Clear Cache</button>

{#if results._tag === 'success'}
  <ul>
    {#each results.value as item}
      <li>{item.name}</li>
    {/each}
  </ul>
{:else if results._tag === 'pending'}
  <p>Searching...</p>
{/if}
```

### Benefits

1. **Automatic Cache Invalidation**: Mutations automatically invalidate related queries
2. **Declarative Dependencies**: Specify what keys a query depends on
3. **Type-Safe**: Full TypeScript inference for queries and mutations
4. **Composable**: Works seamlessly with other Effect primitives
5. **Efficient**: Only re-runs queries when their keys are actually invalidated

This makes it possible to build entire components using Effect's reactive primitives instead of Svelte's built-in state management, while still leveraging Svelte's rendering capabilities.

## Contributing

Contributions are welcome! Please open an issue or pull request on [GitHub](https://github.com/thomasfosterau/effect-svelte).

## License

MIT
