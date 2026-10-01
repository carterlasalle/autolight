// Durable identity (T-ID-01, P-12-rename-survives; closes F-ID-01, F-LIVE-07).
import { describe, expect, it } from "vitest";
import { MemoryAliasStore, aliasesFor, normalizePath, resolveTrackId } from "./alias.js";
import { acousticProposesLink, acousticSimilarity, landmarkHashes, quantize16 } from "./fingerprint.js";
import { fileHashOf } from "./hash.js";
import { derivePlannerSeed } from "./seed.js";

const BYTES = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("file hash", () => {
  it("hashes the full file by default and survives rename, move and retag", () => {
    const a = fileHashOf({ bytes: BYTES("audio-bytes") });
    const b = fileHashOf({ bytes: BYTES("audio-bytes"), strategy: "full" });
    expect(a.hash).toBe(b.hash);
    expect(a.weak).toBe(false);
  });
  it("marks the sampled strategy weaker and folds size into the digest", () => {
    const bytes = BYTES("x".repeat(200));
    const full = fileHashOf({ bytes, strategy: "full" });
    const sampled = fileHashOf({ bytes, sizeBytes: bytes.length, strategy: "sampled" });
    expect(sampled.weak).toBe(true);
    expect(sampled.hash).not.toBe(full.hash);
    expect(fileHashOf({ bytes, sizeBytes: bytes.length + 1, strategy: "sampled" }).hash).not.toBe(sampled.hash);
  });
});

describe("alias graph", () => {
  it("keeps one TrackId across rename, move and retag", () => {
    const store = new MemoryAliasStore();
    const hash = fileHashOf({ bytes: BYTES("song") }).hash;
    let n = 0;
    const first = resolveTrackId(store, { rekordboxId: "101", canonicalPath: "/Music/Aurora.mp3", fileHash: hash, title: "Aurora", artist: "Nova" }, () => `t${++n}`);
    const moved = resolveTrackId(store, { rekordboxId: "101", canonicalPath: "/Sets/Aurora (remastered).mp3", fileHash: hash, title: "Aurora v2", artist: "Nova X" }, () => `t${++n}`);
    expect(moved.trackId).toBe(first.trackId);
    expect(moved.attached).toBe(true);
    expect(store.aliasesOf(first.trackId).length).toBeGreaterThan(2);
  });
  it("matches a re-encoded copy by pcm-hash and keeps title-only input unclaimed", () => {
    const store = new MemoryAliasStore();
    let n = 0;
    const first = resolveTrackId(store, { rekordboxId: "101", pcmFingerprint: "pcm-aaa" }, () => `t${++n}`);
    const reencode = resolveTrackId(store, { rekordboxId: "999", canonicalPath: "/Other/copy.mp3", pcmFingerprint: "pcm-aaa" }, () => `t${++n}`);
    expect(reencode.trackId).toBe(first.trackId);
    const titleOnly = resolveTrackId(store, { title: "Aurora", artist: "Nova" }, () => `t${++n}`);
    expect(titleOnly.trackId).not.toBe(first.trackId);
    expect(aliasesFor({ title: "Aurora", artist: "Nova" })).toEqual([]);
  });
  it("persists aliases across a store rebuild from rows", () => {
    const store = new MemoryAliasStore();
    let n = 0;
    const first = resolveTrackId(store, { rekordboxId: "101", canonicalPath: "/a.mp3", fileHash: "h1" }, () => `t${++n}`);
    const rebuilt = new MemoryAliasStore();
    for (const row of store.all()) rebuilt.insert(row);
    expect(rebuilt.trackIdForAlias("rb:101")).toBe(first.trackId);
    expect(rebuilt.trackIdForAlias(`path:${normalizePath("/a.mp3")}`)).toBe(first.trackId);
  });
});

describe("pcm fingerprint", () => {
  it("quantizes and hashes deterministically; re-encode proposes, never merges", () => {
    const q = quantize16(new Float32Array([0, 0.5, -0.5, 1, -1]));
    expect([...q]).toEqual([0, 16384, -16383, 32767, -32767]);
    const mono = new Float32Array(4096).map((_, i) => Math.sin(i / 8));
    const same = new Float32Array(mono);
    const other = new Float32Array(4096).map((_, i) => Math.sin(i / 3 + 2));
    const hSame = landmarkHashes(same);
    expect(landmarkHashes(mono)).toEqual(hSame);
    expect(acousticSimilarity(hSame, hSame)).toBe(1);
    expect(acousticProposesLink(hSame, hSame)).toBe(true);
    expect(acousticSimilarity(hSame, landmarkHashes(other))).toBeLessThan(0.9);
  });
});

describe("planner seed (T-ID-02)", () => {
  it("gives byte-identical seeds for the same fingerprint with different DB IDs", () => {
    const a = derivePlannerSeed({ pcmFingerprint: "fp-1", nativeId: "101" }, "1.0", "club");
    const b = derivePlannerSeed({ pcmFingerprint: "fp-1", nativeId: "999" }, "1.0", "club");
    expect(a.seed).toBe(b.seed);
    expect(a.seedSource).toBe("pcm-fingerprint");
    expect(a.weak).toBe(false);
  });
  it("falls back to fileHash, then to a flagged weak native ID", () => {
    expect(derivePlannerSeed({ fileHash: "h", nativeId: "1" }, "1.0", "s").seedSource).toBe("file-hash");
    const weak = derivePlannerSeed({ nativeId: "101" }, "1.0", "s");
    expect(weak.seedSource).toBe("native-id-weak");
    expect(weak.weak).toBe(true);
  });
});
