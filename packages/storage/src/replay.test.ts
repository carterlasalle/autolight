import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeRaw, parseStatus } from "@autolight/govee";
import {
  compareSequences,
  type CaptureEvent,
  lintFixture,
  REPLAY_SPEEDS,
  runReplay,
  runReplayAllSpeeds,
  speedFactor,
  VirtualClock,
} from "./replay.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const razerDir = join(repoRoot, "protocol-fixtures", "govee", "razer");
const rekordboxDir = join(repoRoot, "protocol-fixtures", "rekordbox");

interface RazerFixture {
  hex: string;
  base64: string;
  description: string;
  opcode: string;
  payload?: number[];
  gradient?: number;
  zones?: number;
  entries?: unknown;
}

interface StatusFixture {
  description: string;
  json: unknown;
}

function razerFixtures(): { name: string; fixture: RazerFixture }[] {
  const rows = readdirSync(razerDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({ name, fixture: JSON.parse(readFileSync(join(razerDir, name), "utf8")) as RazerFixture }));
  // status-armed.json carries a JSON status reply, not a razer frame.
  return rows.filter(({ fixture }) => typeof fixture.base64 === "string" && typeof fixture.opcode === "string");
}

function captureFixtures(dir: string): { name: string; raw: unknown }[] {
  const out: { name: string; raw: unknown }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...captureFixtures(path));
    else if (entry.name === "capture.json") out.push({ name: path.slice(repoRoot.length + 1), raw: JSON.parse(readFileSync(path, "utf8")) });
  }
  return out;
}

function hexOpcode(opcode: number): string {
  return `0x${opcode.toString(16).padStart(2, "0")}`;
}

// The real decoder path: committed raw bytes in, decoded frame out.
function decodeRazer(event: CaptureEvent): { opcode: string; payload: number[] } | null {
  const payload = event.payload as { base64: string };
  const decoded = decodeRaw(new Uint8Array(Buffer.from(payload.base64, "base64")));
  if (!decoded) return null;
  return { opcode: hexOpcode(decoded.opcode), payload: [...decoded.payload] };
}

describe("protocol replay harness (T-QA-03, spec 128)", () => {
  const fixtures = razerFixtures();
  const events: CaptureEvent[] = fixtures.map(({ name, fixture }, index) => ({
    atMs: (index + 1) * 100,
    kind: fixture.opcode,
    payload: { name, base64: fixture.base64 },
  }));
  const expected = fixtures.map(({ fixture }) => ({
    opcode: fixture.opcode,
    ...(fixture.payload ? { payload: fixture.payload } : {}),
  }));

  it("replays every committed raw capture at 1x, 2x, 10x and step (P-128)", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(18);
    const results = runReplayAllSpeeds(events, decodeRazer);
    for (const speed of REPLAY_SPEEDS) {
      const result = results[speed];
      expect(result.states.length, `${speed} decoded every frame`).toBe(events.length);
      const problems = compareSequences(expected, result.states);
      expect(problems, `${speed} matched the committed frames`).toEqual([]);
    }
    console.info(
      `P-128: ${fixtures.length} committed raw frame fixtures decoded and matched at ${REPLAY_SPEEDS.join("/")}, ` +
        `1x ticks ${results["1x"].ticks}, replay ${results["1x"].replayDurationMs} ms, ` +
        `10x replay ${results["10x"].replayDurationMs} ms`,
    );
  });

  it("changes time with speed, not only timestamps", () => {
    const results = runReplayAllSpeeds(events, decodeRazer);
    const one = results["1x"];
    const two = results["2x"];
    const ten = results["10x"];
    // Event order and tick count are speed independent.
    expect(two.states).toEqual(one.states);
    expect(ten.states).toEqual(one.states);
    expect(two.ticks).toBe(one.ticks);
    expect(ten.ticks).toBe(one.ticks);
    // The virtual clock itself moves faster: the same tick is at 1/10 the time.
    expect(ten.replayDurationMs).toBeCloseTo(one.replayDurationMs / 10, 6);
    expect(two.replayDurationMs).toBeCloseTo(one.replayDurationMs / 2, 6);
    expect(ten.captureDurationMs).toBe(one.captureDurationMs);
    // A decoder that reads the clock sees the compressed time, so downstream
    // time-dependent logic runs at the replayed speed.
    const clocked = runReplayAllSpeeds(events, (_event, clock) => clock.nowMs());
    const stampsOne = clocked["1x"].states;
    const stampsTen = clocked["10x"].states;
    expect(stampsOne.length).toBe(events.length);
    stampsTen.forEach((value, index) => {
      expect(value).toBeCloseTo((stampsOne[index] ?? 0) / 10, 9);
    });
    expect(speedFactor("10x")).toBe(10);
    expect(speedFactor("step")).toBe(1);
  });

  it("steps one event at a time in step mode", () => {
    const stepped = runReplay(events, decodeRazer, { speed: "step" });
    expect(stepped.ticks).toBe(0);
    expect(stepped.states.length).toBe(events.length);
    expect(stepped.stampsMs).toEqual(events.map((event) => event.atMs));
    expect(stepped.replayDurationMs).toBe(events[events.length - 1]?.atMs);
  });

  it("fails replay when the decoder is mutated", () => {
    const mutatedPayload = runReplayAllSpeeds(events, (event) => {
      const decoded = decodeRazer(event);
      if (!decoded || decoded.payload.length === 0) return decoded;
      const bytes = [...decoded.payload];
      bytes[0] = (bytes[0] ?? 0) ^ 0xff;
      return { ...decoded, payload: bytes };
    });
    expect(compareSequences(expected, mutatedPayload["1x"].states).length).toBeGreaterThan(0);

    const brokenChecksum = runReplayAllSpeeds(events, (event) => {
      const payload = event.payload as { base64: string };
      const bytes = new Uint8Array(Buffer.from(payload.base64, "base64"));
      bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
      const decoded = decodeRaw(bytes);
      return decoded ? { opcode: hexOpcode(decoded.opcode), payload: [...decoded.payload] } : null;
    });
    expect(compareSequences(expected, brokenChecksum["1x"].states).length).toBeGreaterThan(0);
  });

  it("decodes the committed status reply through the harness at every speed", () => {
    const status = JSON.parse(readFileSync(join(razerDir, "status-armed.json"), "utf8")) as StatusFixture;
    const statusEvents: CaptureEvent[] = [{ atMs: 250, kind: "status", payload: status.json }];
    const results = runReplayAllSpeeds(statusEvents, (event) => parseStatus(event.payload));
    for (const speed of REPLAY_SPEEDS) {
      // The expectation is the one the fixture documents: on, brightness 80, armed.
      const problems = compareSequences([{ onOff: true, brightness: 80, armed: true }], results[speed].states);
      expect(problems, `${speed} decoded the armed status reply`).toEqual([]);
    }
  });

  it("lints every committed capture fixture and catches a human-less or empty one", () => {
    const captures = captureFixtures(rekordboxDir);
    expect(captures.length).toBeGreaterThanOrEqual(3);
    for (const { name, raw } of captures) {
      expect(lintFixture(raw, { fixture: name, decoderId: "replayFixture" })).toEqual([]);
    }

    const sample = captures[0];
    expect(sample).toBeDefined();
    const withEmptyCapture = { ...(sample?.raw as Record<string, unknown>), capture: "" };
    const emptyProblems = lintFixture(withEmptyCapture, { fixture: "synthetic-empty", decoderId: "replayFixture" });
    expect(emptyProblems.map((problem) => problem.problem).join("\n")).toContain("empty capture");

    const writtenByDecoder = { ...(sample?.raw as Record<string, unknown>), expectedBy: "replayFixture" };
    const authorshipProblems = lintFixture(writtenByDecoder, { fixture: "synthetic-decoder", decoderId: "replayFixture" });
    expect(authorshipProblems.map((problem) => problem.problem).join("\n")).toContain("written by the decoder");

    const missingEvents = { ...(sample?.raw as Record<string, unknown>), expectedEvents: [] };
    expect(lintFixture(missingEvents, { fixture: "synthetic-no-events", decoderId: "replayFixture" }).length).toBeGreaterThan(0);
  });

  it("refuses to move the virtual clock backwards", () => {
    const clock = new VirtualClock();
    clock.advanceTo(100);
    clock.tick(10);
    expect(clock.nowMs()).toBe(110);
    expect(clock.ticks()).toBe(1);
    expect(() => clock.advanceTo(50)).toThrow(/cannot move backwards/);
  });
});
