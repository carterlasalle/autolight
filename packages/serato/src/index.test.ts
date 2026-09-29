import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseCrate } from "./index.js";

describe("serato", () => {
  it("parses a real crate", () => {
    const buf = readFileSync(`${process.env.HOME}/Music/_Serato_/Subcrates/Recorded.crate`);
    const entries = parseCrate(buf);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]!.path.length).toBeGreaterThan(0);
  });
  it("rejects bad magic", () => {
    expect(() => parseCrate(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]))).toThrow();
  });
});
