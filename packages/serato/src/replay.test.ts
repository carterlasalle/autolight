// T-SER-05 proof: every committed Serato capture lints, replays at 1x, 2x, 10x
// and step on the virtual clock, matches its human-written expectedEvents, and
// agrees with the shared T-QA-03 replay harness. A decoder mutation and a
// fixture mutation both turn the comparison red.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DeckState } from "@autolight/contracts";
import { compareSequences, lintFixture, runReplay, type CaptureEvent, type VirtualClock } from "@autolight/storage";
import { SERATO_ACTIONS, framesForAction } from "./emulator.js";
import { SeratoRemoteProvider } from "./remote-provider.js";
import {
  SERATO_BURST_GAP_MS,
  SERATO_REPLAY_SPEEDS,
  framesFromFixture,
  parseSeratoFixture,
  replaySeratoFixture,
  replaySeratoFixtureStep,
  seratoSpeedFactor,
  splitFrames,
  type SeratoFixture,
} from "./replay.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const fixtureRoot = join(repoRoot, "protocol-fixtures", "serato");

const DECODER_ID = "serato-remote";

const TOLERANCE_MS = 5;

function fixtureFiles(): { action: string; raw: unknown; fixture: SeratoFixture }[] {
  const files: { action: string; raw: unknown; fixture: SeratoFixture }[] = [];

  for (const version of readdirSync(fixtureRoot)) {
    const versionDir = join(fixtureRoot, version);

    for (const platform of readdirSync(versionDir)) {
      const platformDir = join(versionDir, platform);

      for (const action of readdirSync(platformDir)) {
        const raw = JSON.parse(readFileSync(join(platformDir, action, "capture.json"), "utf8")) as unknown;
        files.push({ action, raw, fixture: parseSeratoFixture(raw) });
      }
    }
  }

  return files;
}

const FIXTURES = fixtureFiles();

/** The same burst units both harnesses replay: one event per load burst. */
function burstEvents(fixture: SeratoFixture): CaptureEvent[] {
  const frames = framesFromFixture(fixture);
  const events: CaptureEvent[] = [];
  let pending: Buffer[] = [];
  let previousAt = -Infinity;

  const flush = (atMs: number): void => {
    if (pending.length === 0) return;
    events.push({ atMs, kind: "serato-remote-burst", payload: Buffer.concat(pending).toString("base64") });
    pending = [];
  };

  for (const frame of frames) {
    if (pending.length > 0 && frame.atMs - previousAt >= SERATO_BURST_GAP_MS) flush(previousAt);
    pending.push(frame.bytes);
    previousAt = frame.atMs;
  }

  flush(previousAt);

  return events;
}

/** Decoder for the shared harness: real provider on the harness's clock. */
function sharedHarnessDecode(event: CaptureEvent, clock: VirtualClock): DeckState[] {
  const provider = harnessProviders.get(clock) ?? (() => {
    const created = new SeratoRemoteProvider({ now: () => BigInt(Math.round(clock.nowMs())) * 1_000_000n });
    harnessProviders.set(clock, created);

    return created;
  })();

  return provider.ingestFrame(Buffer.from(String(event.payload), "base64"), BigInt(Math.round(clock.nowMs())) * 1_000_000n);
}

const harnessProviders = new Map<VirtualClock, SeratoRemoteProvider>();

/**
 * OSC float arguments are float32 on the wire, so a fixture's human-written
 * decimal (1.08) must be compared against the wire's float32 value. Every
 * number in an expected event came from an `f` argument, so rounding the
 * expectation through Math.fround is the exact comparison, not a fudge.
 */
function froundNumbers(value: unknown): unknown {
  if (typeof value === "number") return Math.fround(value);

  if (Array.isArray(value)) return value.map(froundNumbers);

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, froundNumbers(entry)]));
  }

  return value;
}

function withoutStamp(state: DeckState): Omit<DeckState, "receivedAtNs"> {
  const { receivedAtNs: _stamp, ...rest } = state;

  return rest;
}

describe("serato protocol fixtures and replay (T-SER-05)", () => {
  it("has a non-empty, lint-clean fixture for every Remote-expressible action", () => {
    expect(FIXTURES.length).toBe(SERATO_ACTIONS.length);

    for (const { action, raw, fixture } of FIXTURES) {
      expect(fixture.action).toBe(action);
      expect(fixture.seratoVersion).toBe("3.3.5");
      expect(fixture.platform).toBe("macos");
      expect(fixture.provenance).toContain("pending HW-SER-01");
      const problems = lintFixture(raw, { fixture: action, decoderId: DECODER_ID });
      expect(problems).toEqual([]);
      const frames = framesFromFixture(fixture);
      expect(frames.length).toBe(fixture.frameTimesMs.length);
      expect(frames.every((frame) => splitFrames(frame.bytes).length === 1)).toBe(true);
    }
  });

  it("replays every fixture at 1x, 2x, 10x and step against its expectedEvents", () => {
    for (const { action, fixture } of FIXTURES) {
      for (const speed of SERATO_REPLAY_SPEEDS) {
        const states = speed === "step"
          ? [...replaySeratoFixtureStep(fixture)].flat()
          : replaySeratoFixture(fixture, speed);

        const problems = compareSequences(fixture.expectedEvents.map(froundNumbers), states, { toleranceMs: TOLERANCE_MS });
        expect(problems, `${action} at ${speed}: ${JSON.stringify(problems)}`).toEqual([]);
      }
    }
  });

  it("scales time with the speed and keeps step equal to 1x", () => {
    const fixture = FIXTURES.find((entry) => entry.action === "two-decks")?.fixture as SeratoFixture;
    const at1x = replaySeratoFixture(fixture, "1x");
    const at2x = replaySeratoFixture(fixture, "2x");
    const at10x = replaySeratoFixture(fixture, "10x");
    expect(at2x).toHaveLength(at1x.length);
    expect(at10x).toHaveLength(at1x.length);
    const epoch = 1_000_000_000n;

    for (const [index, state] of at1x.entries()) {
      const offset = state.receivedAtNs - epoch;
      // The provider rewrites same-tick stamps to lastStateAtNs + 1n so
      // receivedAtNs is strictly increasing provider-wide; that bump is
      // bounded by the four remote decks. The scaled clock must still be the
      // floor baseline of the 1x offset.
      const scaled2 = epoch + offset / 2n;
      const scaled10 = epoch + offset / 10n;
      const got2 = at2x[index]?.receivedAtNs ?? 0n;
      const got10 = at10x[index]?.receivedAtNs ?? 0n;

      expect(got2 - scaled2).toBeGreaterThanOrEqual(0n);
      expect(got2 - scaled2).toBeLessThanOrEqual(4n);
      expect(got10 - scaled10).toBeGreaterThanOrEqual(0n);
      expect(got10 - scaled10).toBeLessThanOrEqual(4n);
    }

    const stepped = [...replaySeratoFixtureStep(fixture)].flat();
    expect(stepped).toEqual(at1x);
    expect(seratoSpeedFactor("step")).toBe(1);
  });

  it("agrees with the shared T-QA-03 harness at every speed", () => {
    for (const { action, fixture } of FIXTURES) {
      const events = burstEvents(fixture);

      for (const speed of SERATO_REPLAY_SPEEDS) {
        harnessProviders.clear();
        const shared = runReplay<DeckState[]>(events, sharedHarnessDecode, { speed, tickHz: 1000 }).states.flat();

        const states = speed === "step"
          ? [...replaySeratoFixtureStep(fixture)].flat()
          : replaySeratoFixture(fixture, speed);

        const problems = compareSequences(shared.map(withoutStamp), states.map(withoutStamp), { toleranceMs: TOLERANCE_MS });
        expect(problems, `${action} at ${speed}: ${JSON.stringify(problems)}`).toEqual([]);
      }
    }
  });

  it("stores exactly the frames the emulator scripts produce", () => {
    for (const { action, fixture } of FIXTURES) {
      const fromScript = framesForAction(action as (typeof SERATO_ACTIONS)[number]);
      const stored = framesFromFixture(fixture);
      expect(stored.map((frame) => frame.atMs)).toEqual(fromScript.map((frame) => frame.atMs));
      expect(Buffer.concat(stored.map((frame) => frame.bytes))).toEqual(Buffer.concat(fromScript.map((frame) => frame.bytes)));
    }
  });

  it("goes red when the capture is mutated", () => {
    const fixture = FIXTURES.find((entry) => entry.action === "seek")?.fixture as SeratoFixture;
    const frames = framesFromFixture(fixture);
    const last = frames[frames.length - 1];
    expect(last).toBeDefined();
    expect(frames.length).toBeGreaterThan(0);
    // Byte 36 of the seek frame is the float32 playhead value (30.0 on the
    // wire): flipping it changes decoded state, never frame framing.
    const corrupted = Buffer.from(last?.bytes as Buffer);
    expect(corrupted.length).toBeGreaterThan(40);
    corrupted[36] = (corrupted[36] as number) ^ 0x40;
    const mutated = { ...fixture, capture: Buffer.concat([...frames.slice(0, -1).map((f) => f.bytes), corrupted]).toString("base64") };
    const states = replaySeratoFixture(mutated, "1x");
    const problems = compareSequences(fixture.expectedEvents.map(froundNumbers), states, { toleranceMs: TOLERANCE_MS });
    expect(problems.some((problem) => problem.path.endsWith("playheadSeconds"))).toBe(true);
  });

  it("goes red when expectations do not match the wire", () => {
    const fixture = FIXTURES.find((entry) => entry.action === "play")?.fixture as SeratoFixture;
    const wrong = { ...fixture, expectedEvents: fixture.expectedEvents.map((event, index) => index === 0 ? { ...event, playheadSeconds: 999 } : event) };
    const states = replaySeratoFixture(wrong, "1x");
    const problems = compareSequences(wrong.expectedEvents.map(froundNumbers), states, { toleranceMs: TOLERANCE_MS });
    expect(problems.some((problem) => problem.path.endsWith("playheadSeconds"))).toBe(true);
  });

  it("lints an empty capture and a decoder-authored expectation as problems", () => {
    const fixture = FIXTURES[0] as { action: string; raw: unknown; fixture: SeratoFixture };
    const empty = { ...(fixture.raw as Record<string, unknown>), capture: "" };
    expect(lintFixture(empty, { fixture: fixture.action, decoderId: DECODER_ID }).map((problem) => problem.problem)).toContain("empty capture: record the raw transport bytes");
    const selfWritten = { ...(fixture.raw as Record<string, unknown>), expectedBy: DECODER_ID };
    expect(lintFixture(selfWritten, { fixture: fixture.action, decoderId: DECODER_ID }).map((problem) => problem.problem).join(" ")).toContain("written by the decoder");
  });

  it("rejects a fixture whose frame count does not match its timestamps", () => {
    const fixture = FIXTURES[0]?.fixture as SeratoFixture;
    expect(() => framesFromFixture({ ...fixture, frameTimesMs: [...fixture.frameTimesMs, 999] })).toThrow(/frameTimesMs/);
  });
});
