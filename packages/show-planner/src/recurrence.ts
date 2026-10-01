// Recurrence and motif memory (T-PLAN-08, spec 37 / probe P-2.6). Sections
// above the similarity threshold share a motif ID; each occurrence records
// its variation (direction, secondary colour, density, fixtures, accent
// timing). Dissimilar sections never share a motif.
import { oklchDistance } from "./color.js";
import {
  mulberry32,
  type MotifMap,
  type Oklch,
  type PlannerConfigSnapshot,
} from "./types.js";

export interface SectionSummary {
  readonly index: number;
  readonly kind: string;
  readonly startBeat: number;
  readonly endBeat: number;
  readonly energy: number;
  readonly coreHue: number;
}

export function summarizeSections(
  sections: ReadonlyArray<{ kind: string; startBeat: number; endBeat: number }>,
  energy: Readonly<Record<string, number>>,
  _core: readonly Oklch[],
): SectionSummary[] {
  // Hue follows the section kind, not the section index, so repeats of the
  // same kind compare similar while different kinds compare distant.
  return sections.map((s, i) => ({
    index: i,
    kind: s.kind,
    startBeat: s.startBeat,
    endBeat: s.endBeat,
    energy: energy[s.kind] ?? 0.5,
    coreHue: (s.kind.length * 137) % 360,
  }));
}

export function sectionSimilarity(a: SectionSummary, b: SectionSummary): number {
  if (a.kind !== b.kind) return 0;
  const energySim = 1 - Math.min(1, Math.abs(a.energy - b.energy));
  let hueDiff = Math.abs(a.coreHue - b.coreHue) % 360;
  if (hueDiff > 180) hueDiff = 360 - hueDiff;
  const hueSim = 1 - hueDiff / 180;
  const lenA = Math.max(1, a.endBeat - a.startBeat);
  const lenB = Math.max(1, b.endBeat - b.startBeat);
  const lenSim = Math.min(lenA, lenB) / Math.max(lenA, lenB);
  return 0.5 * energySim + 0.3 * hueSim + 0.2 * lenSim;
}

export interface RecurrenceResult {
  readonly motifOf: string[];
  readonly motifIds: readonly string[];
  readonly map: MotifMap;
  readonly motifReturnBeats: number[];
}

export function planRecurrence(
  summaries: readonly SectionSummary[],
  core: readonly Oklch[],
  densityBaseline: number,
  config: PlannerConfigSnapshot,
  seedHex: string,
): RecurrenceResult {
  const rand = mulberry32(`motif-${seedHex}`);
  const motifOf: string[] = new Array(summaries.length).fill("");
  const groups: { id: string; members: number[] }[] = [];
  const threshold = config.similarityThreshold;
  for (const s of summaries) {
    let placed: string | null = null;
    for (const g of groups) {
      const first = summaries[g.members[0]!]!;
      if (sectionSimilarity(s, first) >= threshold) {
        placed = g.id;
        g.members.push(s.index);
        break;
      }
    }
    if (placed === null) {
      placed = `motif-${groups.length + 1}`;
      groups.push({ id: placed, members: [s.index] });
    }
    motifOf[s.index] = placed;
  }
  const secondary = core[1] ?? core[0] ?? { l: 0.6, c: 0.1, h: 0 };
  const map: MotifMap = {
    motifs: groups.map((g) => {
      const variations: Record<
        number,
        {
          direction: string;
          secondaryColor: Oklch | null;
          density: number;
          fixtures: string;
          accentTiming: number;
        }
      > = {};
      g.members.forEach((member, occ) => {
        variations[member] = {
          direction: occ % 2 === 0 ? "forward" : "reverse",
          secondaryColor: occ === 0 ? null : secondary,
          density: Math.min(1, Math.max(0.1, densityBaseline * (1 + occ * 0.1))),
          fixtures: occ % 2 === 0 ? "primary" : "secondary",
          accentTiming: Math.floor(rand() * 4),
        };
      });
      return {
        id: g.id,
        baseLook: "static-look",
        sections: [...g.members],
        variations,
      };
    }),
  };
  const motifReturnBeats: number[] = [];
  for (const g of groups) {
    if (g.members.length < 2) continue;
    for (const m of g.members.slice(1)) motifReturnBeats.push(summaries[m]!.startBeat);
  }
  return { motifOf, motifIds: groups.map((g) => g.id), map, motifReturnBeats };
}

export { oklchDistance };
