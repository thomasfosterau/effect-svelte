import { Schema } from "effect";

/**
 * A single todo item, modelled as an Effect Schema struct so it can be
 * decoded/encoded when persisting to localStorage.
 */
export const Todo = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  completed: Schema.Boolean,
  createdAt: Schema.Number,
});
export type Todo = typeof Todo.Type;

/** The list of todos as stored in localStorage (JSON string <-> Todo[]). */
export const StoredTodos = Schema.fromJsonString(Schema.Array(Todo));

/** The TodoMVC footer filters. */
export type TodoFilter = "all" | "active" | "completed";

export interface TodoStats {
  readonly total: number;
  readonly active: number;
  readonly completed: number;
}
