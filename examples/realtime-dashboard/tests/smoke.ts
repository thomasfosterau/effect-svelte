import { tick } from "svelte";
import { vi } from "vite-plus/test";

/**
 * Collects every error the mounted app raises outside the test's own call
 * stack: uncaught exceptions and unhandled rejections (a Svelte runtime error
 * such as `effect_update_depth_exceeded` thrown from a scheduled flush lands
 * here), `window` error events, and `console.error` calls (Svelte and Effect
 * report swallowed errors there).
 */
export const captureErrors = () => {
  const errors: Array<unknown> = [];
  const record = (error: unknown) => {
    errors.push(error);
  };
  const onWindowError = (event: ErrorEvent) => record(event.error ?? event.message);
  const onWindowRejection = (event: PromiseRejectionEvent) => record(event.reason);

  process.on("uncaughtException", record);
  process.on("unhandledRejection", record);
  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onWindowRejection);
  const consoleError = vi.spyOn(console, "error").mockImplementation((...args) => record(args));

  return {
    errors,
    dispose: () => {
      process.off("uncaughtException", record);
      process.off("unhandledRejection", record);
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onWindowRejection);
      consoleError.mockRestore();
    },
  };
};

/**
 * Lets the app settle: `rounds` macrotask turns, each followed by a Svelte
 * flush. Effect fibers yield through `setImmediate`, so a run that is still
 * restarting itself keeps scheduling work across these turns, where a settled
 * app does none. Counting calls before and after is how the smoke tests spot
 * a runaway effect without depending on wall-clock time.
 */
export const settle = async (rounds = 20): Promise<void> => {
  for (let round = 0; round < rounds; round++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await tick();
  }
};
