/**
 * A per-request **response-headers buffer** that can ride through `load` data.
 *
 * SvelteKit's `setHeaders` refuses `set-cookie` and throws when the same header
 * is set twice, and components rendering during SSR cannot reach it at all. The
 * pattern the applications converged on is a mutable `Headers` buffer on
 * `event.locals`: loads (and SSR components, via `page.data`) append to it, and
 * a server `handle` copies it onto the outgoing response after `resolve()`.
 *
 * Returning that buffer from a `load` needs a `transport` entry, or SvelteKit
 * refuses to serialise it ("Cannot stringify arbitrary non-POJOs"). Its contents
 * are deliberately *not* round-tripped — the server hook reads the live buffer
 * after rendering, so the client only needs a fresh, empty instance.
 * {@link ResponseHeaders} is the buffer, {@link responseHeadersTransporter} the
 * transport entry, and {@link ResponseHeaders.appendTo} the copy step.
 *
 * @example
 * ```ts
 * // src/hooks.ts
 * import { Hooks } from "@thomasfosterau/effect-sveltekit";
 *
 * export const transport = Hooks.transport({ ResponseHeaders: Hooks.responseHeadersTransporter });
 *
 * // src/hooks.server.ts
 * import { ResponseHeaders } from "@thomasfosterau/effect-sveltekit";
 * import type { Handle } from "@sveltejs/kit/hooks";
 *
 * export const handle: Handle = async ({ event, resolve }) => {
 *   event.locals.headers = new ResponseHeaders();
 *   const response = await resolve(event);
 *   event.locals.headers.appendTo(response.headers);
 *   return response;
 * };
 *
 * // src/routes/+layout.server.ts — expose the buffer to every page
 * export const load = ({ locals }) => ({ headers: locals.headers });
 * ```
 *
 * @module
 */

import type { Transporter } from "@sveltejs/kit/hooks";
import { markerTransporter } from "./transport.js";

/**
 * A `Headers` that serialises to `{}` and knows how to copy itself onto a
 * response. Everything else is the platform `Headers`.
 */
export class ResponseHeaders extends globalThis.Headers {
  /**
   * Append every buffered header to `target` (typically `response.headers`
   * after `resolve()`). Appends rather than sets, so repeated headers such as
   * `set-cookie` all survive.
   */
  appendTo(target: globalThis.Headers): void {
    for (const cookie of this.getSetCookie()) target.append("set-cookie", cookie);
    this.forEach((value, key) => {
      if (key !== "set-cookie") target.append(key, value);
    });
  }

  /** Serialises to an empty object: the contents never leave the server. */
  toJSON(): Record<string, never> {
    return {};
  }
}

/**
 * The `transport` entry for {@link ResponseHeaders}: detected on the server,
 * reconstructed on the client as a fresh, empty buffer.
 */
export const responseHeadersTransporter: Transporter<ResponseHeaders, unknown> = markerTransporter({
  guard: (value): value is ResponseHeaders => value instanceof ResponseHeaders,
  make: () => new ResponseHeaders(),
});
