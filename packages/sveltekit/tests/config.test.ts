import { it } from "@effect/vitest";
import { describe, expect } from "vite-plus/test";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { readConfig, sveltekitConfig, sveltekitConfigProvider } from "../src/config.js";

describe("sveltekitConfigProvider", () => {
  it.effect("resolves Config values from a SvelteKit env record", () =>
    Effect.gen(function* () {
      const provider = sveltekitConfigProvider({
        DATABASE_URL: "postgres://localhost",
        PORT: "3000",
      });

      const databaseUrl = yield* Config.Redacted("DATABASE_URL").parse(provider);
      expect(Redacted.value(databaseUrl)).toBe("postgres://localhost");
      expect(yield* Config.Number("PORT").parse(provider)).toBe(3000);
    }),
  );

  it.effect("ignores undefined env values", () =>
    Effect.gen(function* () {
      const provider = sveltekitConfigProvider({ PRESENT: "yes", ABSENT: undefined });

      expect(yield* Config.String("PRESENT").parse(provider)).toBe("yes");
      const missing = yield* Effect.exit(Config.String("ABSENT").parse(provider));
      expect(missing._tag).toBe("Failure");
    }),
  );
});

describe("empty-string env values (rc.118: treated as missing)", () => {
  const provider = sveltekitConfigProvider({ EMPTY: "" });
  const run = <A>(config: Config.Config<A>) => Effect.exit(config.parse(provider));

  it.effect("fails a required String", () =>
    Effect.gen(function* () {
      expect((yield* run(Config.String("EMPTY")))._tag).toBe("Failure");
    }),
  );

  it.effect("falls back to the default", () =>
    Effect.gen(function* () {
      const exit = yield* run(Config.String("EMPTY").pipe(Config.withDefault("fallback")));
      expect(Exit.isSuccess(exit) && exit.value).toBe("fallback");
    }),
  );

  it.effect("makes option None", () =>
    Effect.gen(function* () {
      const exit = yield* run(Config.String("EMPTY").pipe(Config.option));
      expect(Exit.isSuccess(exit) && Option.isNone(exit.value)).toBe(true);
    }),
  );

  it.effect("falls back to the default for Int", () =>
    Effect.gen(function* () {
      const exit = yield* run(Config.Int("EMPTY").pipe(Config.withDefault(7)));
      expect(Exit.isSuccess(exit) && exit.value).toBe(7);
    }),
  );
});

describe("sveltekitConfig", () => {
  it.effect("installs the provider as a Layer so ambient Config reads resolve", () =>
    Effect.gen(function* () {
      const layer = sveltekitConfig({ GREETING: "hello" });

      // `Config<T>` is itself an `Effect` that resolves the ambient provider.
      const result = yield* Effect.provide(Config.String("GREETING"), layer);
      expect(result).toBe("hello");
    }),
  );

  it("can be merged with an application layer", () => {
    // The config layer is a `Layer<never>`, so it composes with any app layer.
    const merged: Layer.Layer<never> = Layer.merge(sveltekitConfig({ A: "1" }), Layer.empty);
    expect(merged).toBeDefined();
  });
});

describe("readConfig", () => {
  it.effect("resolves a single typed value from an env record", () =>
    Effect.gen(function* () {
      const url = yield* readConfig(
        { PUBLIC_API_URL: "https://api.example.com" },
        Config.String("PUBLIC_API_URL"),
      );
      expect(url).toBe("https://api.example.com");
    }),
  );

  it.effect("resolves a structured Config.all in one call", () =>
    Effect.gen(function* () {
      const settings = yield* readConfig(
        { PUBLIC_API_URL: "https://api.example.com", PORT: "8080" },
        Config.all({ apiUrl: Config.String("PUBLIC_API_URL"), port: Config.Number("PORT") }),
      );
      expect(settings).toEqual({ apiUrl: "https://api.example.com", port: 8080 });
    }),
  );

  it.effect("applies withDefault for absent keys", () =>
    Effect.gen(function* () {
      const value = yield* readConfig(
        {},
        Config.String("PUBLIC_MISSING").pipe(Config.withDefault("fallback")),
      );
      expect(value).toBe("fallback");
    }),
  );

  it.effect("fails with a ConfigError when a required key is absent", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(readConfig({}, Config.String("PUBLIC_REQUIRED")));
      expect(exit._tag).toBe("Failure");
    }),
  );

  it.effect("resolves nested keys joined on underscore", () =>
    Effect.gen(function* () {
      const host = yield* readConfig(
        { DATABASE_HOST: "db.internal" },
        Config.String("HOST").pipe(Config.nested("DATABASE")),
      );
      expect(host).toBe("db.internal");
    }),
  );
});
