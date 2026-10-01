// Protocol replay harness (T-QA-03, spec 128, P-128). Raw captures are
// replayed at 1x, 2x, 10x and step mode over a virtual clock, so speed
// changes time rather than only rewriting timestamps, and normalized
// DeckState sequences are compared with the human-written expectedEvents.
// No physical DJ software is required.

export class VirtualClock {
  private currentMs = 0;
  private tickCount = 0;

  nowMs(): number {
    return this.currentMs;
  }

  nowNs(): bigint {
    return BigInt(Math.round(this.currentMs * 1e6));
  }

  ticks(): number {
    return this.tickCount;
  }

  advanceTo(ms: number): void {
    if (ms < this.currentMs) {
      throw new Error(`virtual clock cannot move backwards: ${ms} < ${this.currentMs}`);
    }
    this.currentMs = ms;
  }

  tick(ms: number): void {
    this.advanceTo(this.currentMs + ms);
    this.tickCount += 1;
  }

  // Absolute advance, so a rate-scaled timeline lands on the same tick index
  // regardless of speed instead of accumulating rounding error.
  tickTo(ms: number): void {
    this.advanceTo(ms);
    this.tickCount += 1;
  }
}

export type ReplaySpeed = "1x" | "2x" | "10x" | "step";

export const REPLAY_SPEEDS: readonly ReplaySpeed[] = ["1x", "2x", "10x", "step"];

export function speedFactor(speed: ReplaySpeed): number {
  if (speed === "2x") return 2;
  if (speed === "10x") return 10;
  return 1;
}

export interface CaptureEvent {
  atMs: number;
  kind: string;
  payload: unknown;
}

export type Decoder<T> = (event: CaptureEvent, clock: VirtualClock) => T | null;

export interface ReplayOptions {
  speed: ReplaySpeed;
  tickHz?: number;
  toleranceMs?: number;
}

export interface ReplayResult<T> {
  speed: ReplaySpeed;
  factor: number;
  states: T[];
  stampsMs: number[];
  ticks: number;
  captureDurationMs: number;
  replayDurationMs: number;
  decodeMs: number;
}

// A replay at speed N puts every capture timestamp at captureTime / N on the
// virtual clock, and ticks the clock at the capture's own cadence divided by
// N. Tick count and event order are therefore identical across speeds; only
// time moves.
export function runReplay<T>(
  events: readonly CaptureEvent[],
  decode: Decoder<T>,
  options: ReplayOptions,
): ReplayResult<T> {
  const factor = speedFactor(options.speed);
  const clock = new VirtualClock();
  const states: T[] = [];
  const stampsMs: number[] = [];
  let decodeMs = 0;
  const sorted = [...events].sort((a, b) => a.atMs - b.atMs);
  const lastEventAt = sorted.length > 0 ? (sorted[sorted.length - 1]?.atMs ?? 0) : 0;

  const decodeAt = (event: CaptureEvent): void => {
    const started = performance.now();
    const state = decode(event, clock);
    decodeMs += performance.now() - started;
    if (state !== null) {
      states.push(state);
      stampsMs.push(clock.nowMs());
    }
  };

  if (options.speed === "step") {
    // Step mode: one event per step, the clock parked on that event's own
    // capture timestamp, no intermediate ticks.
    for (const event of sorted) {
      clock.advanceTo(event.atMs);
      decodeAt(event);
    }
    return {
      speed: options.speed,
      factor,
      states,
      stampsMs,
      ticks: 0,
      captureDurationMs: lastEventAt,
      replayDurationMs: clock.nowMs(),
      decodeMs,
    };
  }

  const tickMs = 1000 / (options.tickHz ?? 60);
  let index = 0;
  let tick = 0;
  while (index < sorted.length) {
    tick += 1;
    // Delivery decisions use the unscaled capture timeline, so every speed
    // decodes the same event on the same tick; the clock itself is scaled.
    const captureNow = tick * tickMs;
    clock.tickTo(captureNow / factor);
    while (index < sorted.length && (sorted[index]?.atMs ?? 0) <= captureNow) {
      decodeAt(sorted[index] as CaptureEvent);
      index += 1;
    }
  }

  return {
    speed: options.speed,
    factor,
    states,
    stampsMs,
    ticks: clock.ticks(),
    captureDurationMs: lastEventAt,
    replayDurationMs: clock.nowMs(),
    decodeMs,
  };
}

export function runReplayAllSpeeds<T>(
  events: readonly CaptureEvent[],
  decode: Decoder<T>,
  options: { tickHz?: number; toleranceMs?: number } = {},
): Record<ReplaySpeed, ReplayResult<T>> {
  const out = {} as Record<ReplaySpeed, ReplayResult<T>>;
  for (const speed of REPLAY_SPEEDS) {
    out[speed] = runReplay(events, decode, {
      speed,
      ...(options.tickHz !== undefined ? { tickHz: options.tickHz } : {}),
      ...(options.toleranceMs !== undefined ? { toleranceMs: options.toleranceMs } : {}),
    });
  }
  return out;
}

export interface ComparisonProblem {
  index: number;
  path: string;
  expected: unknown;
  actual: unknown;
}

export interface CompareOptions {
  // qa.replay.timeToleranceMs: tolerated difference on timing fields.
  toleranceMs?: number;
}

function isTimingField(key: string): boolean {
  return key.endsWith("Ns") || key.endsWith("Ms");
}

function toleranceFor(key: string, toleranceMs: number): number {
  return key.endsWith("Ns") ? toleranceMs * 1e6 : toleranceMs;
}

function compareValue(
  index: number,
  path: string,
  expected: unknown,
  actual: unknown,
  options: CompareOptions,
  problems: ComparisonProblem[],
): void {
  if (expected === null || typeof expected !== "object") {
    if (typeof expected === "number" && typeof actual === "number") {
      const key = path.split(".").pop() ?? "";
      const tolerance = isTimingField(key) ? toleranceFor(key, options.toleranceMs ?? 0) : 0;
      if (Math.abs(expected - actual) > tolerance) problems.push({ index, path, expected, actual });
      return;
    }
    if (JSON.stringify(expected) !== JSON.stringify(actual)) problems.push({ index, path, expected, actual });
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      problems.push({ index, path, expected: `array(${expected.length})`, actual: Array.isArray(actual) ? `array(${actual.length})` : typeof actual });
      return;
    }
    expected.forEach((item, i) => {
      compareValue(index, `${path}[${i}]`, item, actual[i], options, problems);
    });
    return;
  }
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
    problems.push({ index, path, expected, actual });
    return;
  }
  for (const [key, value] of Object.entries(expected as Record<string, unknown>)) {
    compareValue(index, path === "" ? key : `${path}.${key}`, value, (actual as Record<string, unknown>)[key], options, problems);
  }
}

// Expected events are partial snapshots (they omit replay-stamped fields such
// as receivedAtNs), so comparison is a subset check with a tolerance on
// timing fields.
export function compareSequences(
  expected: readonly unknown[],
  actual: readonly unknown[],
  options: CompareOptions = {},
): ComparisonProblem[] {
  const problems: ComparisonProblem[] = [];
  if (expected.length !== actual.length) {
    problems.push({
      index: -1,
      path: "$",
      expected: `array(${expected.length})`,
      actual: `array(${actual.length})`,
    });
    return problems;
  }
  expected.forEach((item, i) => {
    compareValue(i, "", item, actual[i], options, problems);
  });
  return problems;
}

export interface FixtureLintOptions {
  fixture: string;
  decoderId: string;
}

export interface LintProblem {
  fixture: string;
  problem: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Fixture lint (T-QA-03, T-TRU-15): a capture fixture must carry a non-empty
// capture, the software and platform it came from, the action it exercises,
// and expectedEvents authored by a human, never by the decoder itself.
export function lintFixture(raw: unknown, options: FixtureLintOptions): LintProblem[] {
  const problems: LintProblem[] = [];
  const push = (problem: string): void => {
    problems.push({ fixture: options.fixture, problem });
  };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    push("fixture is not an object");
    return problems;
  }
  const fixture = raw as Record<string, unknown>;
  if (text(fixture["capture"]).length === 0) {
    push("empty capture: record the raw transport bytes");
  }
  const software = text(fixture["rekordboxVersion"]) || text(fixture["seratoVersion"]) || text(fixture["softwareVersion"]);
  if (software.length === 0) {
    push("missing software version (rekordboxVersion, seratoVersion or softwareVersion)");
  }
  if (text(fixture["platform"]).length === 0) {
    push("missing platform");
  }
  if (text(fixture["action"]).length === 0) {
    push("missing action");
  }
  const events = fixture["expectedEvents"];
  if (!Array.isArray(events) || events.length === 0) {
    push("expectedEvents is empty");
  }
  const expectedBy = text(fixture["expectedBy"]);
  if (expectedBy.length === 0) {
    push("expectedEvents has no author: expectedBy must name the human who wrote them");
  } else if (expectedBy === options.decoderId || expectedBy === text(fixture["decoder"])) {
    push(`expectedEvents were written by the decoder (${expectedBy}), not by a human`);
  }
  return problems;
}

export interface FixtureLintSummary {
  fixtures: number;
  problems: LintProblem[];
}

export function lintFixtures(
  fixtures: readonly { name: string; raw: unknown }[],
  decoderId: string,
): FixtureLintSummary {
  const problems: LintProblem[] = [];
  for (const fixture of fixtures) {
    problems.push(...lintFixture(fixture.raw, { fixture: fixture.name, decoderId }));
  }
  return { fixtures: fixtures.length, problems };
}
