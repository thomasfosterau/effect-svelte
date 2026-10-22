import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { apiClient } from "../src/api-client.js";

// A small shared API definition (as a consumer would keep in `src/lib`).
const User = Schema.Struct({ id: Schema.String, name: Schema.String });
const api = HttpApi.make("app").add(
  HttpApiGroup.make("users").add(
    HttpApiEndpoint.get("get", "/users/:id", { params: { id: Schema.String }, success: User }),
  ),
);

describe("apiClient", () => {
  it("builds a typed client that encodes the request and decodes the response", async () => {
    const seen: Array<string> = [];
    const fakeFetch: typeof globalThis.fetch = (input) => {
      seen.push(Predicate.isString(input) ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(
        Response.json(
          { id: "1", name: "Ada" },
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    };

    const user = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* apiClient(api, { baseUrl: "http://localhost/api", fetch: fakeFetch });
        return yield* client.users.get({ params: { id: "1" } });
      }),
    );

    expect(user).toEqual({ id: "1", name: "Ada" });
    // The request was sent to the configured base URL + endpoint path.
    expect(seen[0]).toBe("http://localhost/api/users/1");
  });

  it("surfaces a decode failure when the response does not match the schema", async () => {
    const fakeFetch: typeof globalThis.fetch = () =>
      Promise.resolve(
        Response.json(
          { id: 1 },
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

    const exit = await Effect.runPromise(
      Effect.exit(
        Effect.gen(function* () {
          const client = yield* apiClient(api, {
            baseUrl: "http://localhost/api",
            fetch: fakeFetch,
          });
          return yield* client.users.get({ params: { id: "1" } });
        }),
      ),
    );

    expect(exit._tag).toBe("Failure");
  });
});
