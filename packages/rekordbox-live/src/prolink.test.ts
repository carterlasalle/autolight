import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBeatPacket,
  buildKeepalivePacket,
  buildStatusPacket,
  decodeProlinkPacket,
  pitchPercent,
  PROLINK_BEAT_LENGTH,
  PROLINK_MAGIC,
} from "./prolink.js";
import { ProlinkProvider } from "./prolink-provider.js";

interface ProlinkVector {
  name: string;
  kind: string;
  hex: string;
  length: number;
  fields?: Record<string, string | number | boolean>;
  offsets?: Record<string, { offset: string; value: number }>;
}

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "protocol-fixtures", "rekordbox", "golden", "prolink-vectors.json");

// Reason for the cast: this is our own committed fixture, shaped below.
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { vectors: ProlinkVector[] };

const vectors = fixture.vectors;

describe("PRO DJ LINK decode (T-LIVE-05)", () => {
  it("decodes the committed golden vectors", () => {
    for (const vector of vectors) {
      const bytes = Uint8Array.from(Buffer.from(vector.hex, "hex"));
      expect(bytes.length, `${vector.name} length`).toBe(vector.length);
      const decoded = decodeProlinkPacket(bytes);
      expect(decoded.kind, vector.name).toBe(vector.kind);

      if (decoded.kind === "malformed") continue;
      // A decodable vector without fields would silently skip every
      // assertion below: require the fixture to describe what it decodes.
      expect(vector.fields, `${vector.name} must carry fields`).toBeDefined();
      const fields = vector.fields!;

      if (decoded.kind === "beat") {
        expect(decoded.header.deviceName).toBe(fields["deviceName"]);
        expect(decoded.deviceNumber).toBe(fields["deviceNumber"]);
        expect(decoded.nextBeatMs).toBe(fields["nextBeatMs"]);
        expect(decoded.secondBeatMs).toBe(fields["secondBeatMs"]);
        expect(decoded.pitch).toBe(fields["pitchRaw"]);
        expect(decoded.bpm).toBe(fields["bpm"]);
        expect(decoded.beatInBar).toBe(fields["beatInBar"]);
      }

      if (decoded.kind === "status") {
        expect(decoded.trackId).toBe(fields["trackId"]);
        expect(decoded.trackSlot).toBe(fields["trackSlot"]);
        expect(decoded.playState).toBe(fields["playState"]);
        expect(decoded.playing).toBe(fields["playing"]);
        expect(decoded.master).toBe(fields["master"]);
        expect(decoded.sync).toBe(fields["sync"]);
        expect(decoded.beatInBar).toBe(fields["beatInBar"]);
      }

      if (decoded.kind === "keepalive") {
        expect(decoded.deviceNumber).toBe(fields["deviceNumber"]);
      }
    }
  });

  it("reads the documented raw offsets, not just the decoded fields", () => {
    // The vectors self-describe their offsets: each documented byte slot is
    // read from the hex with a width chosen by the documented magnitude, so
    // the fixture (not a parallel hand list) drives the raw-byte contract.
    const readAt = (bytes: Uint8Array, at: number, value: number): number => {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

      if (value > 0xffff) return dv.getUint32(at, true);

      if (value > 0xff) return dv.getUint16(at, true);

      return bytes[at] ?? -1;
    };

    for (const vector of vectors) {
      if (vector.kind !== "beat" && vector.kind !== "status") continue;

      const bytes = Uint8Array.from(Buffer.from(vector.hex, "hex"));

      for (const [field, spec] of Object.entries(vector.offsets ?? {})) {
        expect(readAt(bytes, Number.parseInt(spec.offset, 16), spec.value), `${vector.kind}.${field} at ${spec.offset}`).toBe(spec.value);
      }
    }

    const beat = vectors.find((v) => v.kind === "beat");
    expect(beat).toBeDefined();
    const bytes = Uint8Array.from(Buffer.from(beat?.hex ?? "", "hex"));
    expect(Buffer.from(bytes.subarray(0, 10)).toString("latin1")).toBe(PROLINK_MAGIC);
    expect(bytes[10]).toBe(0x06);
    const status = vectors.find((v) => v.kind === "status");
    const statusBytes = Uint8Array.from(Buffer.from(status?.hex ?? "", "hex"));
    expect(statusBytes[10]).toBe(0x0a);
  });

  it("rejects a random 60-byte datagram and counts it", () => {
    const provider = new ProlinkProvider({ now: () => 0n, sendDatagram: () => {} });
    const sixty = new Uint8Array(60).fill(7);
    expect(decodeProlinkPacket(sixty).kind).toBe("malformed");
    const before = provider.getStats().rejected;
    const decoded = provider.ingestPacket(sixty, 0n);
    expect(decoded.kind).toBe("malformed");
    expect(provider.getStats().rejected).toBe(before + 1);
    expect(provider.getStatus().state).toBe("starting");
    expect(provider.getDecks()).toHaveLength(0);

    // A rejection while live must degrade the status with its reason (the
    // "starting" assert above passes even when this transition is broken).
    const live = new ProlinkProvider({ now: () => 0n, sendDatagram: () => {} });
    live.ingestPacket(buildKeepalivePacket("CDJ-9", 9), 0n);
    expect(live.getStatus().state).toBe("live");
    live.ingestPacket(sixty, 0n);
    const degraded = live.getStatus();
    expect(degraded.state).toBe("degraded");
    expect(degraded.state === "degraded" ? degraded.reason : "").toMatch(/magic/i);
  });

  it("rejects wrong magic, unknown types and wrong lengths", () => {
    const zeros = new Uint8Array(PROLINK_BEAT_LENGTH);
    expect(decodeProlinkPacket(zeros).kind).toBe("malformed");
    const wrongType = buildKeepalivePacket("CDJ-1", 1);
    wrongType[10] = 0x7f;
    expect(decodeProlinkPacket(wrongType).kind).toBe("malformed");
    const shortBeat = buildBeatPacket({ deviceName: "CDJ-1", deviceNumber: 1, nextBeatMs: 500 }).subarray(0, 90);
    expect(decodeProlinkPacket(shortBeat).kind).toBe("malformed");
  });

  it("converts pitch and BPM raw values", () => {
    expect(pitchPercent(0x100000)).toBe(0);
    expect(pitchPercent(0x110000)).toBeCloseTo(6.25, 6);
    const packet = buildBeatPacket({ deviceName: "CDJ-1", deviceNumber: 1, nextBeatMs: 500, pitchRaw: 0x110000, bpm: 128 });
    const decoded = decodeProlinkPacket(packet);
    expect(decoded.kind).toBe("beat");

    if (decoded.kind === "beat") expect(pitchPercent(decoded.pitch)).toBeCloseTo(6.25, 6);
    // Absolute bytes for the status bpm/beatInBar slots, independent of the
    // decoder: a compensating encode/decode regression fails here.
    const status = buildStatusPacket({ deviceName: "CDJ-1", deviceNumber: 1, trackId: 1, trackSlot: 1, playState: 3, bpm: 128, beatInBar: 3 });
    const sv = new DataView(status.buffer, status.byteOffset, status.byteLength);
    expect(sv.getUint16(0x92, true)).toBe(12800);
    expect(status[0x94]).toBe(3);
    const statusDecoded = decodeProlinkPacket(status);
    expect(statusDecoded.kind).toBe("status");

    if (statusDecoded.kind === "status") {
      expect(statusDecoded.bpm).toBe(128);
      expect(statusDecoded.beatInBar).toBe(3);
    }
  });
});

describe("PRO DJ LINK provider (T-LIVE-05, DS-29)", () => {
  it("expires peers after live.prolink.peerExpiryMs", () => {
    let now = 0n;
    const provider = new ProlinkProvider({ now: () => now, peerExpiryMs: 5000 });
    provider.ingestPacket(buildKeepalivePacket("CDJ-9", 9), now);
    expect(provider.getPeers(now)).toHaveLength(1);
    now += 4_000n * 1_000_000n;
    expect(provider.getPeers(now)).toHaveLength(1);
    now += 2_000n * 1_000_000n;
    expect(provider.getPeers(now)).toHaveLength(0);
  });

  it("sends keepalives only in virtual-cdj mode", () => {
    let now = 0n;
    const sent: Uint8Array[] = [];
    const passive = new ProlinkProvider({ now: () => now, mode: "passive", sendDatagram: (bytes) => sent.push(bytes) });
    passive.ingestPacket(buildKeepalivePacket("CDJ-9", 9), now);
    now += 10_000n * 1_000_000n;
    passive.tick(now);
    expect(passive.effectiveMode()).toBe("passive");
    expect(sent).toHaveLength(0);

    const virtual = new ProlinkProvider({ now: () => now, mode: "virtual-cdj", deviceNumber: 7, keepaliveMs: 1500, sendDatagram: (bytes) => sent.push(bytes) });
    expect(virtual.effectiveMode()).toBe("virtual-cdj");
    virtual.tick(now);
    virtual.tick(now);
    expect(sent).toHaveLength(1);
    expect(decodeProlinkPacket(sent[0] ?? new Uint8Array()).kind).toBe("keepalive");
    now += 1_600n * 1_000_000n;
    virtual.tick(now);
    expect(sent).toHaveLength(2);
  });

  it("promotes only while no real device uses the configured number (auto)", () => {
    let now = 0n;
    const sent: Uint8Array[] = [];
    const auto = new ProlinkProvider({ now: () => now, mode: "auto", deviceNumber: 7, peerExpiryMs: 3000, sendDatagram: (bytes) => sent.push(bytes) });
    expect(auto.effectiveMode()).toBe("virtual-cdj");
    auto.ingestPacket(buildKeepalivePacket("CDJ-7", 7), now);
    expect(auto.effectiveMode()).toBe("passive");
    auto.tick(now);
    expect(sent).toHaveLength(0);
    now += 4_000n * 1_000_000n;
    expect(auto.effectiveMode()).toBe("virtual-cdj");
  });

  it("maps status packets to deck state with generation on track change", () => {
    let now = 0n;
    const provider = new ProlinkProvider({ now: () => now, mode: "passive" });
    const states: { generation: number; trackId: string | undefined; playing: boolean; master: boolean | null; sync: boolean | null }[] = [];
    provider.onDeckState((state) => states.push({
      generation: state.generation,
      trackId: state.track?.id,
      playing: state.playing,
      master: state.master,
      sync: state.sync,
    }));
    provider.ingestPacket(buildBeatPacket({ deviceName: "CDJ-1", deviceNumber: 1, nextBeatMs: 468.75, bpm: 128, beatInBar: 1 }), now);
    provider.ingestPacket(buildStatusPacket({
      deviceName: "CDJ-1", deviceNumber: 1, trackId: 111, trackSlot: 1, playState: 3, master: true, sync: true, beatInBar: 1, bpm: 128,
    }), now);
    now += 500n * 1_000_000n;
    provider.ingestPacket(buildStatusPacket({
      deviceName: "CDJ-1", deviceNumber: 1, trackId: 222, trackSlot: 2, playState: 5, master: false, sync: false, beatInBar: 2, bpm: 128,
    }), now);
    const first = states.at(-2);
    const second = states.at(-1);
    expect(first?.trackId).toBe("rb:111");
    expect(first?.playing).toBe(true);
    expect(first?.master).toBe(true);
    expect(second?.trackId).toBe("rb:222");
    expect(second?.playing).toBe(false);
    // Track change bumps generation by exactly one: a jump or a per-emit
    // bump both fail this.
    expect(second?.generation).toBe((first?.generation ?? 0) + 1);
    const latest = provider.getDecks()[0];
    expect(latest?.quality.playheadSeconds).toBe("estimated");
    expect(latest?.pitchPercent).toBe(0);
  });

  it("reads BPM from a status packet without a prior beat packet", () => {
    const provider = new ProlinkProvider({ now: () => 0n, mode: "passive" });
    provider.ingestPacket(buildStatusPacket({
      deviceName: "CDJ-1", deviceNumber: 1, trackId: 555, trackSlot: 1, playState: 3, master: false, sync: false, beatInBar: 1, bpm: 130,
    }), 0n);
    expect(provider.getDecks()[0]?.effectiveBpm).toBe(130);
  });

  it("scales the estimated playhead by the reported pitch", () => {
    const beat = (pitchRaw: number) =>
      buildBeatPacket({ deviceName: "CDJ-1", deviceNumber: 1, nextBeatMs: 400, bpm: 120, beatInBar: 1, pitchRaw });

    const nominal = new ProlinkProvider({ now: () => 0n, mode: "passive" });
    const pitched = new ProlinkProvider({ now: () => 0n, mode: "passive" });
    nominal.ingestPacket(beat(0x100000), 0n);
    nominal.ingestPacket(beat(0x100000), 0n);
    pitched.ingestPacket(beat(0x108000), 0n);
    pitched.ingestPacket(beat(0x108000), 0n);
    expect(nominal.getDecks()[0]?.playheadSeconds).toBeCloseTo(0.5, 5);
    expect(pitched.getDecks()[0]?.playRate).toBeCloseTo(0x108000 / 0x100000, 5);
    expect(pitched.getDecks()[0]?.playheadSeconds).toBeCloseTo(0.5 / (0x108000 / 0x100000), 5);
  });
});
