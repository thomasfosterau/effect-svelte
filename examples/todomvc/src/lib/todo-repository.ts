import { Effect, Schema } from "effect";
import { StoredTodos, type Todo, type TodoFilter, type TodoStats } from "./model";

/** Error raised when todos cannot be read from or written to storage. */
export class TodoStorageError extends Schema.TaggedError<TodoStorageError>()("TodoStorageError", {
  reason: Schema.String,
}) {}

export const STORAGE_KEY = "todos-effect-svelte";

const decodeStored = Schema.decodeUnknown(StoredTodos);
const encodeStored = Schema.encode(StoredTodos);

/**
 * The todo repository service.
 *
 * All persistence goes through Effect: reads decode the stored JSON with
 * `StoredTodos`, writes encode it back. Every method returns an Effect, so
 * the UI layer can run them through the hooks of
 * `@thomasfosterau/effect-svelte`.
 */
export class TodoRepository extends Effect.Service<TodoRepository>()("examples/TodoRepository", {
  sync: () => {
    const readAll: Effect.Effect<ReadonlyArray<Todo>, TodoStorageError> = Effect.gen(function* () {
      const raw = yield* Effect.try({
        try: () => window.localStorage.getItem(STORAGE_KEY),
        catch: (cause) =>
          new TodoStorageError({ reason: `localStorage unavailable: ${String(cause)}` }),
      });
      if (raw === null) {
        return [];
      }
      return yield* decodeStored(raw).pipe(
        Effect.mapError(
          (parseError) => new TodoStorageError({ reason: `corrupt todos: ${parseError.message}` }),
        ),
      );
    });

    const writeAll = (todos: ReadonlyArray<Todo>): Effect.Effect<void, TodoStorageError> =>
      encodeStored(todos).pipe(
        Effect.mapError(
          (parseError) =>
            new TodoStorageError({ reason: `cannot encode todos: ${parseError.message}` }),
        ),
        Effect.flatMap((raw) =>
          Effect.try({
            try: () => window.localStorage.setItem(STORAGE_KEY, raw),
            catch: (cause) =>
              new TodoStorageError({ reason: `localStorage unavailable: ${String(cause)}` }),
          }),
        ),
      );

    /** Read, transform, and persist the todo list atomically. */
    const modify = (
      f: (todos: ReadonlyArray<Todo>) => ReadonlyArray<Todo>,
    ): Effect.Effect<ReadonlyArray<Todo>, TodoStorageError> =>
      Effect.gen(function* () {
        const todos = yield* readAll;
        const next = f(todos);
        yield* writeAll(next);
        return next;
      });

    return {
      getAll: readAll,

      getFiltered: (filter: TodoFilter) =>
        readAll.pipe(
          Effect.map((todos) =>
            filter === "all"
              ? todos
              : todos.filter((todo) => (filter === "completed" ? todo.completed : !todo.completed)),
          ),
        ),

      stats: readAll.pipe(
        Effect.map(
          (todos): TodoStats => ({
            total: todos.length,
            active: todos.filter((todo) => !todo.completed).length,
            completed: todos.filter((todo) => todo.completed).length,
          }),
        ),
      ),

      add: (title: string) =>
        modify((todos) => [
          ...todos,
          {
            id: crypto.randomUUID(),
            title,
            completed: false,
            createdAt: Date.now(),
          },
        ]),

      toggle: (id: string) =>
        modify((todos) =>
          todos.map((todo) => (todo.id === id ? { ...todo, completed: !todo.completed } : todo)),
        ),

      update: (id: string, title: string) =>
        modify((todos) => todos.map((todo) => (todo.id === id ? { ...todo, title } : todo))),

      remove: (id: string) => modify((todos) => todos.filter((todo) => todo.id !== id)),

      toggleAll: (completed: boolean) =>
        modify((todos) => todos.map((todo) => ({ ...todo, completed }))),

      clearCompleted: modify((todos) => todos.filter((todo) => !todo.completed)),
    } as const;
  },
}) {}
