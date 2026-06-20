/**
 * Lazily-created default runtimes (no application layer) backing the package's
 * standalone helpers — the `serverLoad` / `action` / `load` wrappers and the
 * `Hooks` namespaces.
 *
 * They live in their own module so the entry points (`server.ts`,
 * `universal.ts`) and the `Hooks` modules they re-export can all share a single
 * instance without importing one another (which would be circular).
 */

import {
  makeServerRuntime,
  makeUniversalRuntime,
  type ServerRuntime,
  type UniversalRuntime,
} from "../app-runtime.js";

let serverRuntime: ServerRuntime | undefined;
/** The shared default server runtime, created on first use. */
export const defaultServerRuntime = (): ServerRuntime => (serverRuntime ??= makeServerRuntime());

let universalRuntime: UniversalRuntime | undefined;
/** The shared default universal runtime, created on first use. */
export const defaultUniversalRuntime = (): UniversalRuntime =>
  (universalRuntime ??= makeUniversalRuntime());
