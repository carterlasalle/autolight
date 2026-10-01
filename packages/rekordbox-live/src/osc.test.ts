import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeOscDatagram, encodeOscBundle, encodeOscMessage } from "./osc.js";

interface OscVector {
  name: string;
  hex: string;
  address?: string;
  args?: (number | string)[];
  argKinds?: string[];
  roundTrip?: boolean;
  timetag?: number;
  addresses?: string[];
  malformed?: boolean;
}

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "protocol-fixtures", "rekordbox", "golden", "osc-vectors.json");
// Reason for the cast: this is our own committed fixture, shaped below.
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { vectors: OscVector[] };
const vectors = fixture.vectors;

describe("OSC 1.0 codec (T-LIVE-03)", () => {
  it("decodes the committed specification vectors", () => {
    for (const vector of vectors) {
      const bytes = Uint8Array.from(Buffer.from(vector.hex, "hex"));
      const decoded = decodeOscDatagram(bytes);
      if (vector.malformed) {
        expect(decoded.malformed.length, vector.name).toBeGreaterThan(0);
        expect(decoded.messages, vector.name).toHaveLength(0);
        continue;
      }
      expect(decoded.malformed, vector.name).toEqual([]);
      if (vector.address !== undefined) {
        const message = decoded.messages[0];
        expect(message?.address, vector.name).toBe(vector.address);
        for (const [index, expected] of (vector.args ?? []).entries()) {
          expect(message?.args[index], vector.name).toBeCloseTo(Number(expected), 5);
        }
      }
      if (vector.timetag !== undefined) {
        expect(decoded.timetag, vector.name).toBe(BigInt(vector.timetag));
        expect(decoded.messages.map((m) => m.address)).toEqual(vector.addresses);
      }
    }
  });

  it("re-encodes round-trip vectors byte for byte", () => {
    for (const vector of vectors.filter((v) => v.roundTrip === true)) {
      const bytes = encodeOscMessage({ address: vector.address ?? "", args: vector.args ?? [] });
      expect(Buffer.from(bytes).toString("hex"), vector.name).toBe(vector.hex);
    }
  });

  it("encodes a bundle that decodes back to its elements", () => {
    const element = encodeOscMessage({ address: "/1/time", args: [1.5] });
    const bundle = encodeOscBundle(42n, [element]);
    const decoded = decodeOscDatagram(bundle);
    expect(decoded.timetag).toBe(42n);
    expect(decoded.messages).toHaveLength(1);
    expect(decoded.messages[0]?.address).toBe("/1/time");
    expect(decoded.messages[0]?.args[0]).toBeCloseTo(1.5, 5);
  });

  it("reports malformed datagrams instead of throwing", () => {
    expect(decodeOscDatagram(new Uint8Array()).malformed.length).toBeGreaterThan(0);
    expect(decodeOscDatagram(new Uint8Array([0x01, 0x02, 0x03, 0x04])).malformed.length).toBeGreaterThan(0);
    const notAnAddress = encodeOscMessage({ address: "/ok", args: [1] });
    expect(decodeOscDatagram(notAnAddress).messages[0]?.address).toBe("/ok");
  });
});
