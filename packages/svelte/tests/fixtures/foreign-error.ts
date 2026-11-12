/**
 * A failure from outside Effect: what a user callback or a SvelteKit promise
 * throws. Deliberately an untagged `Error` subclass, because the suites assert
 * how the packages surface a foreign error (a defect, a 500, a wrapped cause).
 */
export class ForeignError extends Error {
  override readonly name = "ForeignError";
}
