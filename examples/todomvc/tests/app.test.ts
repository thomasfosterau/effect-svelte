/**
 * Runtime smoke test (#136): mounts the whole TodoMVC app in happy-dom and
 * fails on an uncaught error, a Svelte runtime error, or a query that keeps
 * re-running itself (`useReactiveQuery` looped before #133).
 */
import { Effect } from "effect";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import App from "../src/App.svelte";
import { appRuntime } from "../src/lib/runtime";
import { STORAGE_KEY, TodoRepository } from "../src/lib/todo-repository";
import { captureErrors, settle } from "./smoke";

const seed = [
  { id: "a", title: "Write the smoke test", completed: true, createdAt: 1 },
  { id: "b", title: "Ship it", completed: false, createdAt: 2 },
];

let errors: ReturnType<typeof captureErrors>;
let target: HTMLElement;
let app: Record<string, unknown> | undefined;

beforeEach(() => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
  errors = captureErrors();
  target = document.body.appendChild(document.createElement("div"));
});

afterEach(async () => {
  if (app) await unmount(app);
  app = undefined;
  target.remove();
  window.localStorage.clear();
  errors.dispose();
  vi.restoreAllMocks();
});

const titles = () =>
  [...target.querySelectorAll(".todo-list li label")].map((label) => label.textContent);

describe("TodoMVC", () => {
  it("renders the stored todos, runs each query once, and re-runs them once per mutation", async () => {
    // The app's runtime is a ManagedRuntime, so this is the same repository
    // instance the components use: spy on it to count query runs.
    const repository = await appRuntime.runPromise(
      Effect.gen(function* () {
        return yield* TodoRepository;
      }),
    );
    const getFiltered = vi.spyOn(repository, "getFiltered");
    const reads = vi.spyOn(Storage.prototype, "getItem");

    app = mount(App, { target });
    flushSync();

    await vi.waitFor(() => expect(titles()).toEqual(["Write the smoke test", "Ship it"]));
    await settle();

    // One run of each query (`todos` and `stats`), and nothing after settling.
    expect(getFiltered).toHaveBeenCalledTimes(1);
    expect(reads).toHaveBeenCalledTimes(2);
    expect(target.querySelector(".todo-count")?.textContent).toMatch(/1\s+item left/);

    // Add a todo: the mutation reads and writes once, then invalidating
    // "todos" re-runs both queries exactly once.
    const input = target.querySelector<HTMLInputElement>(".new-todo")!;
    input.value = "Watch CI";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await vi.waitFor(() =>
      expect(titles()).toEqual(["Write the smoke test", "Ship it", "Watch CI"]),
    );
    await settle();

    expect(getFiltered).toHaveBeenCalledTimes(2);
    expect(reads).toHaveBeenCalledTimes(5);
    expect(target.querySelector(".todo-count")?.textContent).toMatch(/2\s+items left/);

    expect(errors.errors).toEqual([]);
  });
});
