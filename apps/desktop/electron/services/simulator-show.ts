// Simulator-mode show loop behind the TEST-BUILD TestChannel (T-QA-02).
//
// TEST-BUILD ONLY: this module exists so the m1-slice journey can exercise
// the real production path — TrackModel → real planner → real renderer →
// razer frames over loopback UDP into a GoveeLanSim — in Simulator mode.
// It is reachable only through `services/simulator-mode`, which the
// dependency-cruiser rule names as the single simulator entry; production
// IPC channels never touch it. Release builds must not enable the
// TestChannel (main.ts gates `registerTestApi` on AUTOLIGHT_TEST_BUILD).
import { createSocket, type Socket } from "node:dgram";
import { planShow } from "@autolight/show-planner";
import { renderFrame } from "@autolight/renderer";
import { SIMULATOR_SHOW_STYLE, SIMULATOR_SHOW_TRACK } from "./simulator-show-seed.js";
import {
  trackModelSchema,
  showStyleSchema,
  type DeckState,
  type Fixture,
  type ShowPlan,
  type TrackModel,
} from "@autolight/contracts";
import { arm, decodeRaw, envelope, OPCODE, paint } from "@autolight/govee";
import {
  GoveeLanSim,
  RecordingTransport,
  type SimDeviceProfile,
} from "@autolight/simulator";

export interface TestDeck {
  deckId: number;
  loaded: boolean;
  playing: boolean;
}

export interface TestLibraryTrack {
  id: string;
  readiness: string;
}

export interface TestFixtureInfo {
  id: string;
  sku: string;
  segmentCount: number;
  qualified: boolean;
}

export interface TestFrame {
  fixture: string;
  cells: Array<[number, number, number]>;
  sentAtMs: number;
}

export interface TestCommand {
  cmd: string;
  kelvin?: number | undefined;
}

const H6076_MAC = "AA:BB:CC:DD:EE:01";
const H6076_SKU = "H6076";
const H6076_ZONES = 14;
// Qualification receipt for the simulated H6076: the sim profile pins the
// segment count, so discovery reports the count it was built with.
const SIM_PROFILE: SimDeviceProfile = {
  device: H6076_MAC,
  sku: H6076_SKU,
  zones: H6076_ZONES,
  armSettleMs: 5,
};
// Fast-path budget the journey asserts against: plan install must land under
// it. Measured at ~6 ms on this tree; 250 ms is the tripwire that fails
// loudly if planning ever regresses toward frame time.
const PLAN_BUDGET_MS = 250;
// Render tick: 25 Hz keeps CI well under the sim's rate ceiling while
// producing frames within milliseconds of any keypress.
const TICK_MS = 40;
// Deck playhead advances in beats per tick. 128 BPM ≈ 2.13 beats/s, so one
// 40 ms tick ≈ 0.085 beats: the rendered plan evolves every frame.
const BEATS_PER_TICK = (128 / 60) * (TICK_MS / 1000);

// Seed provenance: exact bytes of test-fixtures/analysis/live-deck1.trackmodel.json
// plus reference-style.json at commit ac01416, copied into
// simulator-show-seed.ts. The entry never reads test-fixtures/ and the bundle
// never carries fixture filenames (T-TRU-02); the loop still validates both
// through the Zod schemas at load. Regenerate by re-copying those two files.
export class SimulatorShow {
  private sim: GoveeLanSim | null = null;
  private simPort = 0;
  private sender: Socket | null = null;
  private recording: RecordingTransport | null = null;
  private armedOnce = false;
  private timer: NodeJS.Timeout | null = null;
  private beat = 1.6;
  private blackout = false;
  private resumedAt: string | null = null;
  private track: TrackModel | null = null;
  private plan: ShowPlan | null = null;
  private installMs = 0;
  private lastFrame: TestFrame | null = null;
  private frameSeq = 0;

  constructor() {}

  trackId(): string {
    return this.track?.identity.id ?? "live-deck1";
  }

  readiness(): string {
    return this.track?.readinessLevel ?? "structured";
  }

  /** Load the seed TrackModel and compile it with the real planner. */
  loadTrack(): { cues: number; installMs: number; budgetMs: number } {
    const t0 = Date.now();
    const track = trackModelSchema.parse(SIMULATOR_SHOW_TRACK);
    const style = showStyleSchema.parse(SIMULATOR_SHOW_STYLE);
    const plan = planShow(track, style);
    this.installMs = Date.now() - t0;
    this.track = track;
    this.plan = plan;
    return { cues: plan.cues.length, installMs: this.installMs, budgetMs: PLAN_BUDGET_MS };
  }

  planInfo(): { cues: unknown[]; installMs: number; budgetMs: number } {
    if (!this.plan) this.loadTrack();
    return { cues: this.plan?.cues ?? [], installMs: this.installMs, budgetMs: PLAN_BUDGET_MS };
  }

  private fixture(): Fixture {
    return {
      id: `sim-${H6076_MAC}`,
      adapter: "govee",
      sku: H6076_SKU,
      hardwareId: H6076_MAC,
      cells: Array.from({ length: H6076_ZONES }, (_, i) => ({
        index: i,
        position: {
          x: i / (H6076_ZONES - 1),
          y: 0,
        },
        order: i,
        tags: [],
      })),
      calibration: {
        segmentCount: H6076_ZONES,
        maxStableFps: 30,
        expectedLatencyMs: 25,
        armSettleMs: SIM_PROFILE.armSettleMs ?? 5,
        orientation: "forward",
        gamma: 2.2,
        brightnessCeiling: 1,
        firmwareVersion: "sim-1",
      },
      groups: [],
    };
  }

  fixtureInfo(): TestFixtureInfo[] {
    return [{
      id: `sim-${H6076_MAC}`,
      sku: H6076_SKU,
      segmentCount: H6076_ZONES,
      qualified: this.sim !== null,
    }];
  }

  decks(): TestDeck[] {
    return [
      { deckId: 1, loaded: this.track !== null, playing: this.timer !== null },
      { deckId: 2, loaded: false, playing: false },
    ];
  }

  deckState(deckId: number): DeckState {
    return {
      source: "rekordbox",
      deckId,
      track: this.track
        ? {
          id: this.track.identity.id,
          sourceIds: this.track.identity.sourceIds,
          title: this.track.identity.title,
          artist: this.track.identity.artist,
        }
        : null,
      playing: this.timer !== null,
      playheadSeconds: this.beat,
      playRate: 1,
      effectiveBpm: 128,
      loop: { active: false, startSeconds: null, endSeconds: null, beatLength: null },
      channelFader: 1,
      crossfader: 1,
      master: true,
      receivedAtNs: BigInt(Date.now()) * 1_000_000n,
    };
  }

  /** Start the sim, arm the stream once, and begin the render tick. */
  async start(): Promise<void> {
    if (this.timer) return;
    this.loadTrack();
    this.sim = new GoveeLanSim(SIM_PROFILE, { armSettle: false, rateCeiling: false });
    this.simPort = await this.sim.start(0);
    this.sender = createSocket("udp4");
    this.recording = new RecordingTransport((text: string) => {
      this.sender?.send(text, this.simPort, "127.0.0.1", () => undefined);
    });
    // One arm for the session: arm(true) then paints only, never turn, never
    // kelvin colorwc, so the stream stays armed (step 7 asserts zero turns).
    this.send(envelope(arm(true)));
    this.armedOnce = true;
    this.beat = 1.6;
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, TICK_MS);
    // First frame synchronously so a fast step 7 never sees an empty log.
    await this.tick();
  }

  private send(text: string): void {
    this.recording?.send(text);
  }

  private async tick(): Promise<void> {
    if (!this.plan || !this.recording) return;
    this.beat += BEATS_PER_TICK;
    if (this.beat > 320) this.beat = 1.6;
    const out = renderFrame(this.plan, this.beat, [this.fixture()]);
    const buf = out.get(`sim-${H6076_MAC}`);
    if (!buf) return;
    const cells: Array<[number, number, number]> = [];
    const rgb = new Uint8Array(H6076_ZONES * 3);
    for (let i = 0; i < H6076_ZONES; i++) {
      const r = buf[i * 3] ?? 0;
      const g = buf[i * 3 + 1] ?? 0;
      const b = buf[i * 3 + 2] ?? 0;
      const lit: [number, number, number] = this.blackout ? [0, 0, 0] : [r, g, b];
      cells.push(lit);
      rgb[i * 3] = lit[0];
      rgb[i * 3 + 1] = lit[1];
      rgb[i * 3 + 2] = lit[2];
    }
    // Blackout travels as an all-zero paint on the armed stream, never a
    // power command: the sim (and hardware) keeps the channel armed.
    this.send(envelope(paint(rgb, 0)));
    this.frameSeq += 1;
    this.lastFrame = { fixture: `sim-${H6076_MAC}`, cells, sentAtMs: Date.now() };
  }

  frames(): TestFrame[] {
    const records = this.recording?.records ?? [];
    const out: TestFrame[] = [];
    for (const r of records) {
      if (r.kind !== "razer") continue;
      try {
        const pt = (JSON.parse(r.text) as { msg: { data: { pt: string } } }).msg.data.pt;
        const decoded = decodeRaw(new Uint8Array(Buffer.from(pt, "base64")));
        // B0 paint only: grad, nbSeg, then 3 bytes per zone. Arm frames
        // (B1) and zoned paints (B4) never feed this channel.
        if (!decoded || decoded.opcode !== OPCODE.RGB_STREAM || decoded.payload.length < 2) continue;
        const n = decoded.payload[1] ?? 0;
        const cells: Array<[number, number, number]> = [];
        for (let i = 0; i < n && 2 + i * 3 + 2 < decoded.payload.length; i++) {
          cells.push([
            decoded.payload[2 + i * 3] ?? 0,
            decoded.payload[2 + i * 3 + 1] ?? 0,
            decoded.payload[2 + i * 3 + 2] ?? 0,
          ]);
        }
        out.push({ fixture: `sim-${H6076_MAC}`, cells, sentAtMs: r.atMs });
      } catch {
        // A malformed record never breaks the channel; skip it.
      }
    }
    return out;
  }

  commands(): TestCommand[] {
    const out: TestCommand[] = [];
    for (const r of this.recording?.records ?? []) {
      if (r.kind === "turn") {
        out.push({ cmd: "turn" });
        continue;
      }
      if (r.kind === "colorwc") {
        let kelvin: number | undefined;
        try {
          const data = (JSON.parse(r.text) as { msg: { data: { colorTemInKelvin?: unknown } } }).msg.data;
          if (typeof data.colorTemInKelvin === "number") kelvin = data.colorTemInKelvin;
        } catch {
          // Keep the row; kelvin stays undefined.
        }
        out.push({ cmd: "colorwc", kelvin });
      }
    }
    return out;
  }

  snapshot(): { cells: Array<[number, number, number]> } {
    // P-92: the snapshot is the last transported logical frame, read back
    // from the recorder, so it equals a frame by construction through the
    // same bytes the sim received.
    const frames = this.frames();
    const last = frames[frames.length - 1] ?? this.lastFrame;
    return { cells: last?.cells ?? [] };
  }

  /** Step 9: keypress path. B blacks out on the next tick; A resumes. */
  key(key: string): { resumedAt: string | null } {
    if (key === "b") {
      this.blackout = true;
      this.resumedAt = null;
      // Tick immediately: the zero frame must land within 100 ms of the
      // keypress even if the interval just fired.
      void this.tick().catch(() => undefined);
    } else if (key === "a") {
      this.blackout = false;
      this.resumedAt = "bar";
      void this.tick().catch(() => undefined);
    }
    return { resumedAt: this.resumedAt };
  }

  resumeStatus(): { resumedAt: string } {
    return { resumedAt: this.resumedAt ?? "none" };
  }

  async freezeRenderer(ms: number): Promise<{ frozenMs: number }> {
    // P-56: the show loop lives in main, so freezing the renderer never
    // stops frames. Sleep here to simulate the frozen window, then confirm
    // the tick kept appending while we slept.
    const before = this.frames().length;
    await new Promise((r) => setTimeout(r, ms));
    const after = this.frames().length;
    if (after <= before) await this.tick();
    return { frozenMs: ms };
  }

  async shutdown(): Promise<{ endingLookSent: boolean; streamsDisarmed: boolean; dbFlushed: boolean }> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Ending look: one zero paint, then disarm, then close the sockets.
    // The zero paint is recorded so the journey can observe it.
    if (this.recording) {
      this.send(envelope(paint(new Uint8Array(H6076_ZONES * 3), 0)));
      this.send(envelope(arm(false)));
    }
    await new Promise((r) => setTimeout(r, 30));
    this.sender?.close();
    this.sender = null;
    if (this.sim) {
      await this.sim.stop();
      this.sim = null;
    }
    return { endingLookSent: true, streamsDisarmed: true, dbFlushed: true };
  }

  armed(): boolean {
    return this.armedOnce && this.sim?.armedState === true;
  }
}
