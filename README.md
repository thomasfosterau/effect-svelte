# @thomasfosterau/effect-svelte

A library for seamless interoperation between [Effect](https://effect.website/) and [SvelteKit](https://kit.svelte.dev/). This library provides helpers to wrap Effect-based code for use in SvelteKit's load functions, actions, endpoints, and hooks.

## Installation

```bash
npm install @thomasfosterau/effect-svelte effect @sveltejs/kit
```

## Features

- 🔄 **Load Functions**: Wrap Effect code for both server and universal load functions
- ⚡ **Actions**: Convert Effect-based logic into SvelteKit form actions
- 🌐 **Endpoints**: Use Effect in API route handlers
- 🪝 **Hooks**: Integrate Effect into SvelteKit hooks
- 💪 **Type-safe**: Full TypeScript support with proper type inference
- 🎯 **Error Handling**: Automatic Effect error handling and conversion
- 📦 **Namespace API**: Clean, organized API with `SvelteKit` namespace

## Usage

The library provides two entry points:
- `@thomasfosterau/effect-svelte` - Universal (client + server) adapters
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

## Contributing

Contributions are welcome! Please open an issue or pull request on [GitHub](https://github.com/thomasfosterau/effect-svelte).

## License

MIT
