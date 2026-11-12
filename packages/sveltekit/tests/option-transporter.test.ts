import { describe, expect, it } from "vite-plus/test";
import type { Transport } from "@sveltejs/kit/hooks";
import * as devalue from "devalue";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import { optionTransporter, transport } from "../src/transport.js";

/**
 * A value sent the way SvelteKit sends `load` and remote-function data: through
 * devalue, with every transport entry's `encode` as a reducer and its `decode`
 * as the reviver of the same name.
 */
const roundTrip = <A>(hooks: Transport, value: A): A =>
  devalue.parse(
    devalue.stringify(
      value,
      R.map(hooks, (entry) => entry.encode),
    ),
    R.map(hooks, (entry) => entry.decode),
  );

const hooks = transport({ Option: optionTransporter });

/** A fixed instant, as a JS `Date`. */
const date = DateTime.toDateUtc(DateTime.makeUnsafe("2026-11-12T00:00:00.000Z"));

describe("optionTransporter", () => {
  it("round-trips None and a Some of a JSON value", () => {
    expect(roundTrip(hooks, Option.none())).toEqual(Option.none());
    expect(roundTrip(hooks, Option.some(1))).toEqual(Option.some(1));
  });

  it("round-trips a Some of values a JSON codec cannot encode", () => {
    const user = { id: "u1", createdAt: date, visits: 3n, nickname: undefined };
    const back = roundTrip(hooks, Option.some(user));

    expect(back).toEqual(Option.some(user));
    expect(Option.isOption(back)).toBe(true);
    expect(roundTrip(hooks, Option.some(date))).toEqual(Option.some(date));
    expect(roundTrip(hooks, Option.some(new URL("https://example.com/a")))).toEqual(
      Option.some(new URL("https://example.com/a")),
    );
  });

  it("round-trips nested Options", () => {
    expect(roundTrip(hooks, Option.some(Option.some("x")))).toEqual(Option.some(Option.some("x")));
    expect(roundTrip(hooks, Option.some(Option.none()))).toEqual(Option.some(Option.none()));
  });

  it("round-trips Options inside arrays and records", () => {
    const data = {
      list: [Option.some(date), Option.none(), Option.some([Option.some(1)])],
      byId: { a: Option.some({ at: date }), b: Option.none() },
    };

    expect(roundTrip(hooks, data)).toEqual(data);
  });

  it("keeps Some(undefined) and Some(null) distinct from None", () => {
    const someUndefined = roundTrip(hooks, Option.some(undefined));
    const someNull = roundTrip(hooks, Option.some(null));

    expect(someUndefined).toEqual(Option.some(undefined));
    expect(Option.isOption(someUndefined) && Option.isSome(someUndefined)).toBe(true);
    expect(someNull).toEqual(Option.some(null));
    expect(Option.isOption(someNull) && Option.isSome(someNull)).toBe(true);
  });

  it("does not claim a look-alike object", () => {
    const lookAlikes = { none: { _tag: "None" }, some: { _tag: "Some", value: 1 } };

    const sent = devalue.stringify(
      lookAlikes,
      R.map(hooks, (entry) => entry.encode),
    );

    expect(sent).not.toContain('"Option"');
    expect(roundTrip(hooks, lookAlikes)).toEqual(lookAlikes);
  });

  it("lets another transport entry handle the value inside a Some", () => {
    const both = transport({ Option: optionTransporter, DateTime: Schema.DateTimeUtcFromMillis });
    const at = DateTime.makeUnsafe("2026-11-12T00:00:00.000Z");
    const back = roundTrip(both, Option.some({ at }));

    expect(back).toEqual(Option.some({ at }));
  });

  it("shows the hazard: the JSON-codec form throws on a Some of a Date", () => {
    const json = transport({ Option: Schema.toCodecJson(Schema.Option(Schema.Unknown)) });

    expect(() => roundTrip(json, Option.some(date))).toThrow("Expected JSON value");
  });
});
