import { describe, expectTypeOf, it } from "vite-plus/test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type {
  RemoteCommand,
  RemoteForm,
  RemoteFormInput,
  RemotePrerenderFunction,
  RemoteQueryFunction,
} from "@sveltejs/kit";
import { Effect, Schema } from "effect";
import type { CommandFn, FormFn, PrerenderFn, QueryFn } from "../src/remote-functions.js";

// The helpers are `declare`d (never constructed) so importing `remote-functions.ts`
// — and its `$app/server` dependency — costs nothing at runtime. The assertions
// below live inside `typeChecks`, which is exported (so it isn't flagged unused)
// but never invoked: the helper calls are type-checked, never executed.
declare const form: FormFn<never>;
declare const command: CommandFn<never>;
declare const query: QueryFn<never>;
declare const prerender: PrerenderFn<never>;

// A real-world form schema: required fields plus an *optional* field. An
// optional Effect-Schema field encodes to `T | undefined`, which is not
// assignable to `RemoteFormInput`'s index signature — the regression this suite
// guards against is the validated helpers rejecting such schemas.
const SignUp = Schema.Struct({
  email: Schema.String,
  _password: Schema.String,
  redirectTo: Schema.optional(Schema.String),
});

type SignUpType = (typeof SignUp)["Type"];
type SignUpEncoded = (typeof SignUp)["Encoded"];

export function typeChecks() {
  // ── form: raw Effect Schema with an optional field (no cast) ──────────────
  const signUpForm = form(SignUp, (data) =>
    Effect.gen(function* () {
      // `data` is the precisely-decoded schema `Type`.
      expectTypeOf(data).toEqualTypeOf<SignUpType>();
      return yield* Effect.succeed(data.email);
    }),
  );
  // The produced form's input is the encoded type intersected with
  // `RemoteFormInput`, so SvelteKit still sees a form-input-shaped input.
  expectTypeOf(signUpForm).toEqualTypeOf<RemoteForm<SignUpEncoded & RemoteFormInput, string>>();

  // ── form: Schema.toStandardSchemaV1-wrapped Standard Schema (no cast) ─────
  const SignUpStd = Schema.toStandardSchemaV1(SignUp);
  const signUpStdForm = form(SignUpStd, (data) => {
    expectTypeOf(data).toEqualTypeOf<StandardSchemaV1.InferOutput<typeof SignUpStd>>();
    return Effect.succeed(data.email);
  });
  expectTypeOf(signUpStdForm).toEqualTypeOf<
    RemoteForm<StandardSchemaV1.InferInput<typeof SignUpStd> & RemoteFormInput, string>
  >();

  // ── form: a RemoteFormInput-clean schema still infers as before ───────────
  const Clean = Schema.Struct({ name: Schema.String });
  const cleanForm = form(Clean, (data) => {
    expectTypeOf(data).toEqualTypeOf<{ readonly name: string }>();
    return Effect.succeed(data.name);
  });
  // `{ name: string }` already satisfies `RemoteFormInput`, so intersecting is
  // equivalent to the bare encoded type — and still a valid `RemoteForm`.
  expectTypeOf(cleanForm).toEqualTypeOf<
    RemoteForm<{ readonly name: string } & RemoteFormInput, string>
  >();

  // ── form: the bare (no-validation) overload is unaffected ─────────────────
  const noInput = form(() => Effect.succeed(42));
  expectTypeOf(noInput).toEqualTypeOf<RemoteForm<void, number>>();

  // ── command / query / prerender accept the optional-field schema too ──────
  const signUpCommand = command(SignUp, (data) => {
    expectTypeOf(data).toEqualTypeOf<SignUpType>();
    return Effect.succeed(data.email);
  });
  expectTypeOf(signUpCommand).toEqualTypeOf<RemoteCommand<SignUpEncoded, string>>();

  const signUpQuery = query(SignUp, (data) => {
    expectTypeOf(data).toEqualTypeOf<SignUpType>();
    return Effect.succeed(data.email);
  });
  expectTypeOf(signUpQuery).toEqualTypeOf<RemoteQueryFunction<SignUpEncoded, string>>();

  const signUpPrerender = prerender(SignUp, (data) => {
    expectTypeOf(data).toEqualTypeOf<SignUpType>();
    return Effect.succeed(data.email);
  });
  expectTypeOf(signUpPrerender).toEqualTypeOf<RemotePrerenderFunction<SignUpEncoded, string>>();
}

describe("remote-function validators accept schemas with optional fields", () => {
  // The substantive coverage is the type-level `typeChecks` body above, which
  // `vp check` type-checks. This runtime test only asserts it is wired up.
  it("type-checks (see typeChecks)", () => {
    expectTypeOf(typeChecks).toBeFunction();
  });
});
