import { describe, expect, it } from "vite-plus/test";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { readConfig, sveltekitConfig, sveltekitConfigProvider } from "../src/config.js";

describe("sveltekitConfigProvider", () => {
  it("resolves Config values from a SvelteKit env record", () => {
    const provider = sveltekitConfigProvider({
      DATABASE_URL: "postgres://localhost",
      PORT: "3000",
    });

    const databaseUrl = Effect.runSync(Config.Redacted("DATABASE_URL").parse(provider));
    expect(Redacted.value(databaseUrl)).toBe("postgres://localhost");
    expect(Effect.runSync(Config.Number("PORT").parse(provider))).toBe(3000);
  });

  it("ignores undefined env values", () => {
    const provider = sveltekitConfigProvider({ PRESENT: "yes", ABSENT: undefined });

    expect(Effect.runSync(Config.String("PRESENT").parse(provider))).toBe("yes");
    const missing = Effect.runSync(Effect.exit(Config.String("ABSENT").parse(provider)));
    expect(missing._tag).toBe("Failure");
  });
});

describe("empty-string env values (rc.118: treated as missing)", () => {
  const provider = sveltekitConfigProvider({ EMPTY: "" });
  const run = <A>(config: Config.Config<A>) => Effect.runSync(Effect.exit(config.parse(provider)));

  it("fails a required String", () => {
    expect(run(Config.String("EMPTY"))._tag).toBe("Failure");
  });

  it("falls back to the default", () => {
    const exit = run(Config.String("EMPTY").pipe(Config.withDefault("fallback")));
    expect(Exit.isSuccess(exit) && exit.value).toBe("fallback");
  });

  it("makes option None", () => {
    const exit = run(Config.String("EMPTY").pipe(Config.option));
    expect(Exit.isSuccess(exit) && Option.isNone(exit.value)).toBe(true);
  });

  it("falls back to the default for Int", () => {
    const exit = run(Config.Int("EMPTY").pipe(Config.withDefault(7)));
    expect(Exit.isSuccess(exit) && exit.value).toBe(7);
  });
});

describe("sveltekitConfig", () => {
  it("installs the provider as a Layer so ambient Config reads resolve", async () => {
    const layer = sveltekitConfig({ GREETING: "hello" });

    // `Config<T>` is itself an `Effect` that resolves the ambient provider.
    const result = await Effect.runPromise(Effect.provide(Config.String("GREETING"), layer));
    expect(result).toBe("hello");
  });

  it("can be merged with an application layer", () => {
    // The config layer is a `Layer<never>`, so it composes with any app layer.
    const merged: Layer.Layer<never> = Layer.merge(sveltekitConfig({ A: "1" }), Layer.empty);
    expect(merged).toBeDefined();
  });
});

describe("readConfig", () => {
  it("resolves a single typed value from an env record", async () => {
    const url = await Effect.runPromise(
      readConfig({ PUBLIC_API_URL: "https://api.example.com" }, Config.String("PUBLIC_API_URL")),
    );
    expect(url).toBe("https://api.example.com");
  });

  it("resolves a structured Config.all in one call", async () => {
    const settings = await Effect.runPromise(
      readConfig(
        { PUBLIC_API_URL: "https://api.example.com", PORT: "8080" },
        Config.all({ apiUrl: Config.String("PUBLIC_API_URL"), port: Config.Number("PORT") }),
      ),
    );
    expect(settings).toEqual({ apiUrl: "https://api.example.com", port: 8080 });
  });

  it("applies withDefault for absent keys", async () => {
    const value = await Effect.runPromise(
      readConfig({}, Config.String("PUBLIC_MISSING").pipe(Config.withDefault("fallback"))),
    );
    expect(value).toBe("fallback");
  });

  it("fails with a ConfigError when a required key is absent", async () => {
    const exit = await Effect.runPromise(
      Effect.exit(readConfig({}, Config.String("PUBLIC_REQUIRED"))),
    );
    expect(exit._tag).toBe("Failure");
  });

  it("resolves nested keys joined on underscore", async () => {
    const host = await Effect.runPromise(
      readConfig(
        { DATABASE_HOST: "db.internal" },
        Config.String("HOST").pipe(Config.nested("DATABASE")),
      ),
    );
    expect(host).toBe("db.internal");
  });
});
