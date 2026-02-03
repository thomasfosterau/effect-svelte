import { createContext } from "svelte";
import type { Runtime } from "effect";

/**
 * Type-safe context for Effect runtime management.
 * Uses Svelte 5's createContext API for better type safety and developer experience.
 */
const [getRuntime, provideRuntime] = createContext<Runtime.Runtime<any>>();

export { getRuntime, provideRuntime };
