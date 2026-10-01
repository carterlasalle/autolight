import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { axFractionalBeat, axPermissionState, readAxDecks, refineAxReading, type AxNode } from "./ax.js";
import { AxProvider } from "./ax-provider.js";

interface TreeFixture {
  platform: string;
  note: string;
  root: AxNode[];
}

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "protocol-fixtures", "rekordbox", "ax");
// Reason for the casts: these are our own committed fixtures, shaped below.
const macos = JSON.parse(readFileSync(join(fixtureDir, "macos-tree.json"), "utf8")) as TreeFixture;
const windows = JSON.parse(readFileSync(join(fixtureDir, "windows-tree.json"), "utf8")) as TreeFixture;
const noDecks = JSON.parse(readFileSync(join(fixtureDir, "no-decks-tree.json"), "utf8")) as TreeFixture;

function tree(deckOneElapsed: string, deckOneRemaining: string, deckTwoElapsed: string): AxNode[] {
  return [
    {
      role: "AXGroup",
      position: 0,
      label: "Deck 1",
      children: [
        { role: "AXStaticText", position: 0, label: "track title", value: "Deck One" },
        { role: "AXStaticText", position: 1, label: "elapsed time", value: deckOneElapsed },
        { role: "AXStaticText", position: 2, label: "remaining time", value: deckOneRemaining },
      ],
    },
    {
      role: "AXGroup",
      position: 1,
      label: "Deck 2",
      children: [
        { role: "AXStaticText", position: 0, label: "track title", value: "Deck Two" },
        { role: "AXStaticText", position: 1, label: "elapsed time", value: deckTwoElapsed },
      ],
    },
  ];
}

describe("AX tree reading (T-LIVE-06)", () => {
  it("separates decks and their fields on the recorded macOS tree", () => {
    const readings = readAxDecks(macos.root);
    expect(readings.map((r) => r.deckId)).toEqual([1, 2]);
    const [one, two] = readings;
    expect(one?.title).toBe("Nice For What");
    expect(one?.elapsedSeconds).toBe(12);
    expect(one?.remainingSeconds).toBe(-168);
    expect(one?.playing).toBe(false);
    expect(two?.title).toBe("Homecoming (feat. Chris Martin)");
    expect(two?.elapsedSeconds).toBe(65);
    expect(two?.playing).toBe(true);
  });

  it("separates decks on the recorded Windows tree and reads the label hints", () => {
    const readings = readAxDecks(windows.root);
    expect(readings.map((r) => r.deckId)).toEqual([1, 2]);
    expect(readings[0]?.elapsedSeconds).toBe(12);
    expect(readings[0]?.remainingSeconds).toBe(-168);
    expect(readings[0]?.playing).toBe(false);
    expect(readings[1]?.playing).toBe(true);
  });

  it("refuses to guess when elapsed and remaining look the same", () => {
    const ambiguous = readAxDecks(tree("0:12", "0:12", "1:05"));
    expect(refineAxReading(ambiguous[0]!, undefined).readable).toBe(false);
    const clear = readAxDecks(tree("0:12", "-2:48", "1:05"));
    expect(refineAxReading(clear[0]!, undefined).readable).toBe(true);
  });

  it("derives playing from the field that decreases when no button is exposed", () => {
    const first = refineAxReading(readAxDecks(tree("0:12", "-2:48", "1:05"))[0]!, undefined);
    const later = refineAxReading(readAxDecks(tree("0:13", "-2:47", "1:05"))[0]!, first);
    expect(first.playing).toBeNull();
    expect(later.playing).toBe(true);
    const paused = refineAxReading(readAxDecks(tree("0:13", "0:13", "1:05"))[0]!, later);
    expect(paused.readable).toBe(false);
  });

  it("maps elapsed seconds onto the grid as fractional beats", () => {
    const grid = [{ sourceTimeMs: 0 }, { sourceTimeMs: 345 }, { sourceTimeMs: 690 }];
    expect(axFractionalBeat(0, grid)).toBe(1);
    expect(axFractionalBeat(0.5, grid)).toBeCloseTo(2.449, 3);
    expect(axFractionalBeat(10, grid)).toBe(3);
    expect(axFractionalBeat(1, [])).toBeNull();
  });

  it("states the macOS permission remedy", () => {
    const denied = axPermissionState(false);
    expect(denied.granted).toBe(false);
    expect(denied.remedy).toContain("System Settings > Privacy & Security > Accessibility");
    expect(axPermissionState(true).granted).toBe(true);
  });
});

describe("AX provider (T-LIVE-06)", () => {
  it("emits estimated playhead quality and a fractional beat from the grid", () => {
    const provider = new AxProvider({ now: () => 0n, intervalMs: 0 });
    provider.setGrid(1, [{ sourceTimeMs: 11_800 }, { sourceTimeMs: 12_200 }]);
    const emitted: { deckId: number; beat: number | null; quality: string | undefined; playing: boolean }[] = [];
    provider.onDeckState((state) => emitted.push({
      deckId: state.deckId, beat: state.beat, quality: state.quality.playheadSeconds, playing: state.playing,
    }));
    provider.ingestTree(macos.root, 0n);
    expect(emitted).toHaveLength(2);
    const deckOne = emitted.find((s) => s.deckId === 1);
    expect(deckOne?.quality).toBe("estimated");
    expect(deckOne?.beat).toBeCloseTo(1.5, 5);
    expect(deckOne?.playing).toBe(false);
    expect(provider.getStatus().state).toBe("live");
    expect(provider.getDecks()[0]?.quality.playing).toBe("derived");
  });

  it("emits nothing for an unreadable deck and reports degraded", () => {
    const provider = new AxProvider({ now: () => 0n, intervalMs: 0 });
    const emitted: number[] = [];
    provider.onDeckState((state) => emitted.push(state.deckId));
    provider.ingestTree(tree("0:12", "0:12", "1:05"), 0n);
    expect(emitted).toEqual([2]);
    expect(provider.getStatus().state).toBe("degraded");
    expect(provider.getDecks().map((d) => d.deckId)).toEqual([1, 2]);
  });

  it("stays unavailable without Accessibility permission and never marks AX live", async () => {
    const provider = new AxProvider({ now: () => 0n, intervalMs: 0, permissionGranted: false });
    await provider.start();
    const emitted: number[] = [];
    provider.onDeckState((state) => emitted.push(state.deckId));
    const status = provider.getStatus();
    expect(status.state).toBe("unavailable");
    if (status.state === "unavailable") {
      expect(status.reason).toBe("Accessibility permission not granted");
      expect(status.remedy).toContain("Accessibility");
    }
    expect(provider.ingestTree(macos.root, 0n)).toEqual([]);
    expect(emitted).toEqual([]);
    expect(provider.getStatus().state).toBe("unavailable");
    await provider.stop();
  });

  it("rejects a tree with no deck containers and counts it", () => {
    const provider = new AxProvider({ now: () => 0n, intervalMs: 0 });
    expect(provider.ingestTree(noDecks.root, 0n)).toEqual([]);
    expect(provider.getStats().rejected).toBe(1);
    expect(provider.getStatus().state).toBe("degraded");
  });

  it("coalesces trees that arrive inside live.ax.intervalMs", () => {
    const provider = new AxProvider({ now: () => 0n, intervalMs: 250 });
    expect(provider.ingestTree(macos.root, 0n)).toHaveLength(2);
    expect(provider.ingestTree(macos.root, 100_000_000n)).toHaveLength(0);
    expect(provider.ingestTree(macos.root, 300_000_000n)).toHaveLength(2);
    expect(provider.getIntervalMs()).toBe(250);
    expect(provider.getTimeoutMs()).toBe(2000);
  });
});
