import { describe, expect, it } from "vitest";
import { encodeFrame, FrameCoalescer } from "./index.js";
describe("govee", () => {
  it("round-trips xor", () => {
    const f = encodeFrame(0xb0, new Uint8Array([1, 2, 3]));
    expect(f[0]).toBe(0xbb);
    let x = 0; for (let i = 1; i < f.length - 1; i++) x ^= f[i]!;
    expect(x).toBe(f[f.length - 1]);
  });
  it("coalesces to newest", () => {
    const c = new FrameCoalescer();
    c.push(new Uint8Array([1])); c.push(new Uint8Array([2]));
    expect(c.take()).toEqual(new Uint8Array([2]));
    expect(c.take()).toBeNull();
  });
});
