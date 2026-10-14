import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
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

// Resolve upward instead of assuming one relative depth: a layout change
// must fail with the path it tried, not a module-load ENOENT stack (batch-21).
function fixtureFile(relative: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));

  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, relative);

    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }

  throw new Error(`test fixture ${relative} not found within 6 levels of ${import.meta.url}`);
}

const fixturePath = fixtureFile(join("protocol-fixtures", "rekordbox", "golden", "osc-vectors.json"));

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

        // The fixture declares the OSC type tag per arg: the decoded wire
        // bytes must carry exactly those tags, and each decoded value must be
        // a number. A decoder that emits floats for int tags (or vice versa)
        // re-encodes different bytes, so this fails rather than passing on
        // value alone.
        if (vector.argKinds !== undefined) {
          const raw = Uint8Array.from(Buffer.from(vector.hex, "hex"));
          let end = 0;

          while (raw[end] !== 0) end++;
          let at = Math.ceil((end + 1) / 4) * 4;
          let tagEnd = at;

          while (raw[tagEnd] !== 0) tagEnd++;
          const tags = new TextDecoder().decode(raw.subarray(at + 1, tagEnd));
          expect(tags, vector.name).toBe(vector.argKinds.join(""));

          for (const [index, kind] of vector.argKinds.entries()) {
            if (kind === "i" || kind === "f") expect(typeof message?.args[index], vector.name).toBe("number");
            else if (kind === "s") expect(typeof message?.args[index], vector.name).toBe("string");
            else if (kind === "b") expect(message?.args[index], vector.name).toBeInstanceOf(Uint8Array);
          }
        }
      }

      if (vector.timetag !== undefined) {
        expect(decoded.timetag, vector.name).toBe(BigInt(vector.timetag));
        expect(decoded.messages.map((m) => m.address)).toEqual(vector.addresses);
        // The bundle vector carries args too: a decoder that drops a bundle
        // element's arguments must fail here, not just on addresses.
        for (const [index, expected] of (vector.args ?? []).entries()) {
          const elementArgs = decoded.messages.flatMap((m) => [...m.args]);
          expect(elementArgs[index], vector.name).toBeCloseTo(Number(expected), 5);
        }
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
    expect(decoded.messages).toHaveLength(1);
    expect(decoded.messages[0]?.address).toBe("/1/time");
    expect(decoded.messages[0]?.args[0]).toBeCloseTo(1.5, 5);
  });
  it("round-trips string and blob arguments through the s and b tags", () => {
    const args = ["Fixture A", new Uint8Array([0xde, 0xad, 0xbe, 0xef])] as (string | Uint8Array)[];
    const decoded = decodeOscDatagram(encodeOscMessage({ address: "/1/track/name", args }));
    expect(decoded.malformed).toEqual([]);
    expect(decoded.messages).toHaveLength(1);
    expect(decoded.messages[0]?.address).toBe("/1/track/name");
    expect(decoded.messages[0]?.args[0]).toBe("Fixture A");
    expect(decoded.messages[0]?.args[1]).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it("re-encodes bundles with encodeOscBundle when the vector carries a timetag", () => {
    // No committed round-trip vector is a bundle today; the committed bundle
    // vector re-encodes through the same bundle path, so a message/bundle
    // codec mismatch fails here instead of passing silently.
    expect(vectors.some((v) => v.roundTrip === true && v.timetag !== undefined)).toBe(false);

    for (const vector of vectors.filter((v) => v.timetag !== undefined)) {
      const elements = (vector.addresses ?? []).map((address, i) =>
        encodeOscMessage({ address, args: vector.args?.[i] === undefined ? [] : [vector.args[i] as number] }),
      );
      const bytes = encodeOscBundle(BigInt(vector.timetag ?? 0), elements);
      expect(Buffer.from(bytes).toString("hex"), vector.name).toBe(vector.hex);
    }
  });

  it("reports malformed datagrams instead of throwing", () => {
    expect(decodeOscDatagram(new Uint8Array()).malformed.length).toBeGreaterThan(0);
    expect(decodeOscDatagram(new Uint8Array([0x01, 0x02, 0x03, 0x04])).malformed.length).toBeGreaterThan(0);
    // A first token that is not an OSC address ("ok" has no leading slash) is
    // malformed, not a message. The old assertion encoded a valid /ok message
    // here, which only repeated the happy path and never exercised this case.
    const notAnAddress = decodeOscDatagram(new Uint8Array([0x6f, 0x6b, 0x00, 0x00]));
    expect(notAnAddress.malformed.length).toBeGreaterThan(0);
    expect(notAnAddress.messages).toHaveLength(0);
  });

  it("never throws on hostile bytes: unterminated header, blob overrun, bundle residue", () => {
    // No NUL within range: the old top-level pre-read threw RangeError out of
    // the decoder and crashed the UDP caller (S26).
    const noNul = decodeOscDatagram(new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]));
    expect(noNul.messages).toEqual([]);
    expect(noNul.malformed.length).toBeGreaterThan(0);
    // Blob length prefix overruns the datagram: rejected, offsets uncorrupted.
    const overrun = new Uint8Array([
      0x2f, 0x61, 0x00, 0x00, 0x2c, 0x62, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x64,
    ]);
    const overrunDecoded = decodeOscDatagram(overrun);
    expect(overrunDecoded.messages).toEqual([]);
    expect(overrunDecoded.malformed.length).toBeGreaterThan(0);
    // Residual bytes after the last bundle element: malformed, not clean.
    const element = encodeOscMessage({ address: "/a", args: [1] });
    const bundle = encodeOscBundle(1n, [element]);
    const ragged = new Uint8Array(bundle.length + 2);
    ragged.set(bundle, 0);
    ragged.set([0xff, 0xff], bundle.length);
    const raggedDecoded = decodeOscDatagram(ragged);
    expect(raggedDecoded.messages).toHaveLength(1);
    expect(raggedDecoded.malformed.length).toBeGreaterThan(0);
  });

  it("throws on integers outside the int32 range instead of emitting lossy float32", () => {
    expect(() => encodeOscMessage({ address: "/a", args: [5_000_000_001] })).toThrow(/int32/);
    expect(() => encodeOscMessage({ address: "/a", args: [-(2 ** 31) - 1] })).toThrow(/int32/);
  });
});
