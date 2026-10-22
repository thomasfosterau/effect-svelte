import { assert, describe, expect, it } from "vite-plus/test";
import type { Transport, Transporter } from "@sveltejs/kit/hooks";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import { markerTransporter, transport, transporter } from "../src/transport.js";

/** Narrow away the `false` branch of an `encode` result (asserting it matched). */
const encoded = <U>(value: false | U): U => {
  if (value === false) throw new Error("expected the transporter to encode the value");
  return value;
};

/** A fixed instant, as a JS `Date` (what `Schema.Date` encodes). */
const dateAt = (iso: string): Date => DateTime.toDateUtc(DateTime.makeUnsafe(iso));

/** The transporter `t` holds under `label`, asserting it has one. */
const entry = (t: Transport, label: string): Transporter => {
  const found = t[label];
  assert(found !== undefined, `expected a transporter labelled ${label}`);
  return found;
};

/** The labels of `t`, sorted. */
const labels = (t: Transport): ReadonlyArray<string> => Arr.sort(Rec.keys(t), Order.String);

describe("transporter", () => {
  it("encodes a matching value to a truthy tuple and decodes it back", () => {
    const t = transporter(Schema.Date);
    const date = dateAt("2026-06-19T00:00:00.000Z");

    const out = encoded(t.encode(date));
    // Wrapped in a single-element tuple so the encoding is always truthy.
    expect(Array.isArray(out)).toBe(true);

    const decoded = t.decode(out);
    expect(decoded).toBeInstanceOf(Date);
    expect(decoded.toISOString()).toBe(date.toISOString());
  });

  it("returns false for values it does not handle", () => {
    // Widened to Kit's untyped `Transporter`: the hook hands `encode` any value.
    const t: Transporter = transporter(Schema.Date);
    expect(t.encode("not a date")).toBe(false);
    expect(t.encode(42)).toBe(false);
  });

  it("round-trips an Option (whose encoding can be falsy)", () => {
    const t = transporter(Schema.Option(Schema.Number));

    const some = encoded(t.encode(Option.some(0)));
    expect(t.decode(some)).toStrictEqual(Option.some(0));

    const none = encoded(t.encode(Option.none()));
    expect(t.decode(none)).toStrictEqual(Option.none());
  });
});

class LiveHandle {
  readonly _tag = "LiveHandle";
}

describe("markerTransporter", () => {
  it("emits a truthy marker for matching values and reconstructs a fresh one", () => {
    const t = markerTransporter({
      guard: (v): v is LiveHandle => v instanceof LiveHandle,
      make: () => new LiveHandle(),
    });

    const original = new LiveHandle();
    const out = encoded(t.encode(original));
    expect(out).toBe(1); // default truthy marker

    const decoded = t.decode(out);
    expect(decoded).toBeInstanceOf(LiveHandle);
    // A *fresh* value, not the original (contents do not round-trip).
    expect(decoded).not.toBe(original);
  });

  it("returns false for values it does not handle", () => {
    // Widened to Kit's untyped `Transporter`: the hook hands `encode` any value.
    const t: Transporter = markerTransporter({
      guard: (v): v is LiveHandle => v instanceof LiveHandle,
      make: () => new LiveHandle(),
    });
    expect(t.encode("x")).toBe(false);
  });

  it("honours a custom marker", () => {
    const t = markerTransporter({
      guard: (v): v is LiveHandle => v instanceof LiveHandle,
      make: () => new LiveHandle(),
      marker: "live",
    });
    expect(t.encode(new LiveHandle())).toBe("live");
  });
});

describe("transport", () => {
  it("builds a Transport record keyed by label", () => {
    const t = transport({
      Date: Schema.Date,
      Option: Schema.Option(Schema.String),
    });

    expect(labels(t)).toStrictEqual(["Date", "Option"]);

    const date = dateAt("2026-01-01T00:00:00.000Z");
    expect(entry(t, "Date").encode(date)).not.toBe(false);
    // The Option transporter rejects a Date and vice versa.
    expect(entry(t, "Option").encode(date)).toBe(false);
    expect(entry(t, "Date").encode(Option.some("x"))).toBe(false);
  });

  it("mixes schema codecs and ready transporters (e.g. markerTransporter)", () => {
    const t = transport({
      Date: Schema.Date,
      Live: markerTransporter({
        guard: (v): v is LiveHandle => v instanceof LiveHandle,
        make: () => new LiveHandle(),
      }),
    });

    expect(labels(t)).toStrictEqual(["Date", "Live"]);
    expect(entry(t, "Live").encode(new LiveHandle())).toBe(1);
    expect(entry(t, "Live").encode(dateAt("2026-01-01T00:00:00.000Z"))).toBe(false);
    expect(entry(t, "Date").encode(new LiveHandle())).toBe(false);
  });
});
