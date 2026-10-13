// T-SEC-04 Serato side: reads are pure, files open read-only, no write API exists.
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as serato from "./index.js";

const created: string[] = [];

function crateFixture(): { path: string; bytes: Uint8Array } {
  const dir = mkdtempSync(join(tmpdir(), "autolight-serato-sec04-"));
  created.push(dir);

  const encode = (s: string): number[] => {
    const out: number[] = [];

    for (const ch of s) {
      const code = ch.charCodeAt(0);
      out.push((code >> 8) & 0xff, code & 0xff);
    }

    return out;
  };

  const row = (path: string): number[] => {
    const ptrk = [0x70, 0x74, 0x72, 0x6b, 0, 0, 0, path.length * 2, ...encode(path)];

    return [0x6f, 0x74, 0x72, 0x6b, 0, 0, 0, ptrk.length, ...ptrk];
  };

  const body = [...row("/music/a.mp3"), ...row("/music/b.mp3")];
  const bytes = new Uint8Array([0x76, 0x72, 0x73, 0x6e, 0, 0, 0, 0, ...body]);
  const path = join(dir, "Set.crate");
  writeFileSync(path, bytes);

  return { path, bytes };
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

describe("T-SEC-04 serato read-only", () => {
  it("parses the crate identically before and after the full run, checksum stable", () => {
    const { path, bytes } = crateFixture();
    expect(new Uint8Array(readFileSync(path))).toEqual(bytes);
    const before = sha256File(path);
    const first = serato.parseCrate(new Uint8Array(readFileSync(path)));
    expect(first.map((entry) => entry.path)).toEqual(["/music/a.mp3", "/music/b.mp3"]);
    const second = serato.parseCrate(new Uint8Array(readFileSync(path)));
    expect(second).toEqual(first);
    expect(sha256File(path)).toBe(before);
  });

  it("rejects corrupt crates instead of writing or repairing them", () => {
    expect(() => serato.parseCrate(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]))).toThrow(/bad crate magic/);
    expect(() => serato.parseBeatGrid(new Uint8Array([2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toThrow(/beatgrid version=2/);
    expect(() => serato.parseBeatGrid(new Uint8Array([1, 0]))).toThrow(/beatgrid too short/);
  });

  it("keeps Remote mapping pure: same snapshot in gives the same DeckState out", () => {
    const msg = {
      deckId: 1,
      filepath: "/m/track.mp3",
      playing: true,
      playheadSeconds: 30,
      playRate: 1,
      effectiveBpm: 128,
      loopActive: false,
      loopStartSeconds: null,
      loopEndSeconds: null,
      loopBeatLength: null,
      channelFader: 0.8,
      crossfader: 0.5,
      trackChanged: false,
      raw: { deck: 1 },
    };

    const snapshot = structuredClone(msg);
    const a = serato.remoteToDeckState(msg, 5n);
    const b = serato.remoteToDeckState({ ...msg, raw: { deck: 1 } }, 5n);
    expect(b).toEqual(a);
    expect(msg).toEqual(snapshot);
  });

  it("exposes no write-shaped export", () => {
    // Prefix match: an anchored bare-verb pattern misses writeCrate/saveTrack
    // style names. createSeratoWatcher is the reviewed exception: it only
    // builds a read-only watcher, never writes.
    for (const name of Object.keys(serato)) {
      expect(name).not.toMatch(/\b(insert|update|delete|upsert|write|save|remove|drop|exec|checkpoint)\w*/i);
    }

    expect("createSeratoWatcher" in serato).toBe(true);
    expect("writeCrate" in serato).toBe(false);
    expect("saveCrate" in serato).toBe(false);
    expect("updateBeatGrid" in serato).toBe(false);
  });
});
