import { describe, expect, it } from "vite-plus/test";
import { Config, Effect, Layer } from "effect";
import { readConfig, sveltekitConfig, sveltekitConfigProvider } from "../src/config.js";

describe("sveltekitConfigProvider", () => {
  it("resolves Config values from a SvelteKit env record", () => {
    const provider = sveltekitConfigProvider({
      DATABASE_URL: "postgres://localhost",
      PORT: "3000",
    });

    expect(Effect.runSync(Config.String("DATABASE_URL").parse(provider))).toBe(
      "postgres://localhost",
    );
    expect(Effect.runSync(Config.Number("PORT").parse(provider))).toBe(3000);
  });

  it("ignores undefined env values", () => {
    const provider = sveltekitConfigProvider({ PRESENT: "yes", ABSENT: undefined });

    expect(Effect.runSync(Config.String("PRESENT").parse(provider))).toBe("yes");
    const missing = Effect.runSync(Effect.exit(Config.String("ABSENT").parse(provider)));
    expect(missing._tag).toBe("Failure");
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
