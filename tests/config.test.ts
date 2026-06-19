import { describe, expect, it } from "vite-plus/test";
import { Config, Effect, Layer } from "effect";
import { sveltekitConfig, sveltekitConfigProvider } from "../src/kit/config.js";

describe("sveltekitConfigProvider", () => {
  it("resolves Config values from a SvelteKit env record", () => {
    const provider = sveltekitConfigProvider({
      DATABASE_URL: "postgres://localhost",
      PORT: "3000",
    });

    expect(Effect.runSync(Config.string("DATABASE_URL").parse(provider))).toBe(
      "postgres://localhost",
    );
    expect(Effect.runSync(Config.number("PORT").parse(provider))).toBe(3000);
  });

  it("ignores undefined env values", () => {
    const provider = sveltekitConfigProvider({ PRESENT: "yes", ABSENT: undefined });

    expect(Effect.runSync(Config.string("PRESENT").parse(provider))).toBe("yes");
    const missing = Effect.runSync(Effect.exit(Config.string("ABSENT").parse(provider)));
    expect(missing._tag).toBe("Failure");
  });
});

describe("sveltekitConfig", () => {
  it("installs the provider as a Layer so ambient Config reads resolve", async () => {
    const layer = sveltekitConfig({ GREETING: "hello" });

    // `Config<T>` is itself an `Effect` that resolves the ambient provider.
    const result = await Effect.runPromise(Effect.provide(Config.string("GREETING"), layer));
    expect(result).toBe("hello");
  });

  it("can be merged with an application layer", () => {
    // The config layer is a `Layer<never>`, so it composes with any app layer.
    const merged: Layer.Layer<never> = Layer.merge(sveltekitConfig({ A: "1" }), Layer.empty);
    expect(merged).toBeDefined();
  });
});
