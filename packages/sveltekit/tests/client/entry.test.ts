/**
 * The `./client` entry exports every namespace member twice: through its
 * namespace (`Navigation.goto`) and as a plain named export (`goto`), which a
 * browser bundle can tree-shake member by member (#195). The two must be the
 * same values, and no member may be missing from the flat exports.
 */

import * as Arr from "effect/Array";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";
import * as Client from "../../src/client.js";

const namespaces = {
  Navigation: Client.Navigation,
  State: Client.State,
  Remote: Client.Remote,
  Realtime: Client.Realtime,
  Forms: Client.Forms,
  Hooks: Client.Hooks,
} as const;

/** The entry's exports, as `[name, value]` pairs. */
const flat = R.toEntries({ ...Client });

/** The names of `ns`'s members that the entry does not also export, by name, as the same value. */
const missingFlat = (ns: R.ReadonlyRecord<string, unknown>): ReadonlyArray<string> =>
  Arr.filterMap(R.toEntries(ns), ([name, value]) =>
    Arr.some(flat, ([exported, exportedValue]) => exported === name && exportedValue === value)
      ? Result.failVoid
      : Result.succeed(name),
  );

/** How many members `ns` has. */
const memberCount = (ns: R.ReadonlyRecord<string, unknown>): number => R.size(ns);

describe("./client flat named exports (#195)", () => {
  it.each(R.toEntries(namespaces))("%s: every member is also a named export", (_, ns) => {
    expect(memberCount({ ...ns })).toBeGreaterThan(0);
    expect(missingFlat({ ...ns })).toEqual([]);
  });
});
