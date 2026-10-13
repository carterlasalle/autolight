// Plug-and-play proof for the composite FLX4 provider (F-LIVE-06 MIDI part).
//
// A virtual MIDI driver (scripted `Flx4MidiDriver`, no hardware) proves the
// full chain open→map→fuse→close: plug-in opens `DDJ-FLX4 MIDI 1`
// non-exclusively, real PLAY/CUE/jog/tempo/fader bytes map per the T-FLX-02
// map and fuse with the ANLZ beatgrid, AX fusion rebases without overriding,
// board-absent boot logs `FLX4 not present, composite idle` and closes clean.
import { describe, expect, it } from "vitest";
import {
  Flx4ControllerService,
  type Flx4MidiDriver,
  type Flx4PortInfo,
} from "@autolight/controller-flx4";
import {
  FLX4_IDLE_MESSAGE,
  FLX4_MACOS_DEVICE_NAME,
  FLX4_MACOS_PORT_NAME,
  startCompositeFlx4Boot,
  stopCompositeFlx4Boot,
  type CompositeFlx4BootOptions,
} from "./composite-boot.js";
import { compositeFuseAxPlayhead } from "./composite.js";

const VIRTUAL_PORT: Flx4PortInfo = { id: "0", name: FLX4_MACOS_PORT_NAME };

function virtualDriver(ports: Flx4PortInfo[]): Flx4MidiDriver & {
  emit: (bytes: readonly number[]) => void;
  openCount: () => number;
  closeCount: () => number;
} {
  const listeners = new Set<(bytes: readonly number[]) => void>();
  let opens = 0;
  let closes = 0;

  return {
    name: "native",
    sharing: "shared",
    probe: () => Promise.resolve({ ok: true, reason: "" }),
    listPorts: () => Promise.resolve([...ports]),
    open: (port, onMessage) => {
      opens += 1;
      listeners.add(onMessage);

      return Promise.resolve({
        port,
        close: () => {
          listeners.delete(onMessage);
          closes += 1;
        },
      });
    },
    emit: (bytes) => {
      for (const listener of listeners) listener(bytes);
    },
    openCount: () => opens,
    closeCount: () => closes,
  };
}

async function bootWith(driver: Flx4MidiDriver, extra: Partial<CompositeFlx4BootOptions> = {}) {
  const logs: string[] = [];

  const result = await startCompositeFlx4Boot({
    log: (message) => logs.push(message),
    createService: (serviceOpts) =>
      new Flx4ControllerService({ ...serviceOpts, mode: "native", drivers: { native: driver } }),
    ...extra,
  });

  return { ...result, logs };
}

describe("composite-flx4 plug-and-play", () => {
  it("opens a virtual port, maps PLAY/CUE/jog/tempo/faders, fuses with the grid, then closes", async () => {
    const driver = virtualDriver([VIRTUAL_PORT]);
    const { boot, connected, logs } = await bootWith(driver);

    try {
      expect(connected).toBe(true);
      expect(logs.some((line) => line.includes("connected on"))).toBe(true);

      // Recorded session: LOAD, CUE-set (stopped), PLAY, tempo 14-bit pair,
      // channel fader pair, crossfader pair, jog nudge — same bytes as the
      // T-FLX-06 session. CUE-then-PLAY keeps the deck playing at the end.
      const session: [number, number, number][] = [
        [0x96, 0x46, 0x7f],
        [0x90, 0x0c, 0x7f],
        [0x90, 0x0b, 0x7f],
        [0xb0, 0x00, 0x48],
        [0xb0, 0x20, 0x10],
        [0xb0, 0x13, 0x60],
        [0xb0, 0x33, 0x08],
        [0xb6, 0x1f, 0x30],
        [0xb6, 0x3f, 0x08],
        [0xb0, 0x22, 0x45],
      ];

      for (const bytes of session) driver.emit(bytes);
      const events = boot.service.recentEvents(32);
      expect(events.length).toBeGreaterThan(0);
      expect(events.some((event) => event.type === "control" && event.id === "deck1.play")).toBe(true);
      expect(events.some((event) => event.type === "control" && event.id === "deck1.cue")).toBe(true);
      expect(events.some((event) => event.type === "control" && event.id === "mixer.crossfader")).toBe(true);
      const deck = boot.provider.getDecks().find((d) => d.deckId === 1);
      expect(deck?.playing).toBe(true);
      expect(deck?.channelFader).not.toBeNull();
      expect(boot.service.status().portName).toBe(FLX4_MACOS_PORT_NAME);
      // Non-exclusive open: single shared read, no exclusive flag anywhere.
      expect(driver.openCount()).toBe(1);

      // AX fusion rebases the MIDI anchor through the pure helper path.
      expect(boot.fuseAx(1, 12.5, 2_000_000_000_000n)).toBe(true);
      expect(boot.fuseAx(1, null, 2_000_000_000_000n)).toBe(false);
    } finally {
      await boot.stop();
    }

    expect(driver.closeCount()).toBe(1);
    await stopCompositeFlx4Boot();
  });

  it("logs idle instead of failing when the board is absent", async () => {
    const driver = virtualDriver([]);
    const { boot, connected, logs } = await bootWith(driver);

    try {
      expect(connected).toBe(false);
      expect(logs).toContain(FLX4_IDLE_MESSAGE);
      expect(boot.provider.getStatus().state).toBe("unavailable");
    } finally {
      await boot.stop();
    }

    await stopCompositeFlx4Boot();
  });

  it("documents the exact macOS device and port names", () => {
    expect(FLX4_MACOS_DEVICE_NAME).toBe("DDJ-FLX4");
    expect(FLX4_MACOS_PORT_NAME).toBe("DDJ-FLX4 MIDI 1");
  });

  it("fuses only fresh AX input and never invents a playhead", () => {
    const at = 1_000_000_000_000n;

    const fused = compositeFuseAxPlayhead({
      anchorPosSeconds: 3,
      anchorAtNs: at,
      axPlayheadSeconds: 12.5,
      atNs: at,
    });

    expect(fused).toEqual({ anchorPosSeconds: 12.5, anchorAtNs: at, fused: true });

    const ignored = compositeFuseAxPlayhead({
      anchorPosSeconds: 3,
      anchorAtNs: at,
      axPlayheadSeconds: null,
      atNs: at,
    });

    expect(ignored.fused).toBe(false);
    expect(ignored.anchorPosSeconds).toBe(3);
  });
});
