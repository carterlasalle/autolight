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
      if (decoded.kind === "malformed" || !vector.fields) continue;
      const fields = vector.fields;
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
    const beat = vectors.find((v) => v.kind === "beat");
    expect(beat).toBeDefined();
    const bytes = Uint8Array.from(Buffer.from(beat?.hex ?? "", "hex"));
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(Buffer.from(bytes.subarray(0, 10)).toString("latin1")).toBe(PROLINK_MAGIC);
    expect(bytes[10]).toBe(0x06);
    expect(dv.getUint32(0x24, true)).toBe(50000);
    expect(dv.getUint32(0x28, true)).toBe(25000);
    expect(dv.getUint32(0x38, true)).toBe(0x100000);
    expect(dv.getUint16(0x5a, true)).toBe(12800);
    expect(bytes[0x5c]).toBe(1);
    const status = vectors.find((v) => v.kind === "status");
    const statusBytes = Uint8Array.from(Buffer.from(status?.hex ?? "", "hex"));
    const sdv = new DataView(statusBytes.buffer, statusBytes.byteOffset, statusBytes.byteLength);
    expect(sdv.getUint32(0x2c, true)).toBe(1234567);
    expect(statusBytes[0x6f]).toBe(3);
    expect(statusBytes[0x75]).toBe(0x30);
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
    expect((second?.generation ?? 0) > (first?.generation ?? 0)).toBe(true);
    const latest = provider.getDecks()[0];
    expect(latest?.quality.playheadSeconds).toBe("estimated");
    expect(latest?.pitchPercent).toBe(0);
  });
});
