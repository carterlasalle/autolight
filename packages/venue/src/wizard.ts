import type { CellAnchor, CellMap, MappedCell, Run } from "./placement.js";
import { applyLogicalOrder, fitRunMapping, runLength } from "./placement.js";

export type WizardDirection = "clockwise" | "counterclockwise" | "both";
export type RunTopology = "single" | "split-independent" | "split-mirrored";

export interface SimStrip {
  cellCount: number;
  cellToArcM: number[];
  mirrored: boolean;
  gaps: { fromM: number; toM: number }[];
}

export function classifyDirection(answer: WizardDirection): RunTopology | "unknown" {
  if (answer === "both") return "split-independent";
  if (answer === "clockwise" || answer === "counterclockwise") return "single";
  return "unknown";
}

export function mirrorCheck(observedPlaces: number): {
  topology: RunTopology;
  orbitAllowed: boolean;
  offered: string[];
  note: string;
} {
  if (observedPlaces >= 2) {
    return {
      topology: "split-mirrored",
      orbitAllowed: false,
      offered: ["SymmetricSweep", "Converge", "Diverge", "Ripple", "Breathe"],
      note: "One cell lights in two places: this controller mirrors one run onto both sides (Y-split). True orbits are impossible because every cell appears twice; use symmetric motion and let other fixtures break symmetry.",
    };
  }
  return {
    topology: "single",
    orbitAllowed: true,
    offered: ["Orbit", "PerimeterOrbit", "Ripple", "Fill", "SplitAlternate"],
    note: "One cell lights in one place: each wire index maps to one position.",
  };
}

export function bisectCorner(cornerArcM: number, litArcM: number): "before" | "after" {
  return litArcM < cornerArcM ? "before" : "after";
}

export interface WizardFit {
  cells: MappedCell[];
  maxErrCells: number;
}

export function fitWizardRun(
  run: Run,
  cellCount: number,
  anchors: CellAnchor[],
  zeroS: number,
  direction: "clockwise" | "counterclockwise",
  midS: number[],
): { cells: MappedCell[]; gaps: CellMap["gaps"] } {
  const cells = fitRunMapping(run, cellCount, anchors);
  const ordered = applyLogicalOrder(cells, midS, zeroS, direction);
  const gaps = (run.gaps ?? []).map((g) => ({ run: run.id, fromM: g.fromM, toM: g.toM }));
  return { cells: ordered, gaps };
}

export function virtualUserAnchors(strip: SimStrip, run: Run, corners: number[]): CellAnchor[] {
  const anchors: CellAnchor[] = [
    { cell: 0, run: run.id, atMeters: strip.cellToArcM[0]! },
    { cell: strip.cellCount - 1, run: run.id, atMeters: strip.cellToArcM[strip.cellCount - 1]! },
  ];
  for (const c of corners) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < strip.cellCount; i++) {
      const d = Math.abs(strip.cellToArcM[i]! - c);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (!anchors.some((a) => a.cell === best)) anchors.push({ cell: best, run: run.id, atMeters: c });
  }
  return anchors.sort((a, b) => a.cell - b.cell);
}

export function fitErrorCells(fitted: MappedCell[], truthM: number[], runLen: number, cellCount: number): number {
  const pitch = runLen / Math.max(1, cellCount);
  let worst = 0;
  for (const c of fitted) {
    const p = c.positions[0]!;
    const mid = (p.startM + p.endM) / 2;
    worst = Math.max(worst, Math.abs(mid - truthM[c.physicalIndex]!) / pitch);
  }
  return worst;
}

export function runWizardOnSim(
  strip: SimStrip,
  run: Run,
  corners: number[],
  zeroS: number,
  direction: "clockwise" | "counterclockwise",
): WizardFit & { topology: RunTopology; orbitAllowed: boolean } {
  const mirror = mirrorCheck(strip.mirrored ? 2 : 1);
  const anchors = virtualUserAnchors(strip, run, corners);
  const runLen = runLength(run);
  const midS = strip.cellToArcM.map((m) => m / runLen);
  const { cells } = fitWizardRun(run, strip.cellCount, anchors, zeroS, direction, midS);
  return {
    cells,
    maxErrCells: fitErrorCells(cells, strip.cellToArcM, runLen, strip.cellCount),
    topology: mirror.topology,
    orbitAllowed: mirror.orbitAllowed,
  };
}

export function verifyOffset(headS: number[], expectedS: number[], toleranceCells: number): { ok: boolean; suggestShift: number } {
  let err = 0;
  for (let i = 0; i < headS.length; i++) {
    let d = Math.abs(headS[i]! - expectedS[i]!);
    d = Math.min(d, 1 - d);
    err += d;
  }
  const mean = err / Math.max(1, headS.length);
  if (mean <= toleranceCells) return { ok: true, suggestShift: 0 };
  let shift = 0;
  let best = mean;
  for (let s = -3; s <= 3; s++) {
    if (s === 0) continue;
    let e = 0;
    for (let i = 0; i < headS.length; i++) {
      let d = Math.abs(headS[i]! - expectedS[i]! + s / Math.max(1, headS.length));
      d = Math.min(d, 1 - d);
      e += d;
    }
    if (e / headS.length < best) { best = e / headS.length; shift = s; }
  }
  return { ok: false, suggestShift: shift };
}
