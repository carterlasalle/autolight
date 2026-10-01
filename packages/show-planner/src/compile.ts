// Compiler: planShow(input) -> { plan, diagnostics, rejected } (T-PLAN-01).
// Reads upcoming events and plans backwards from drops (spec 2.1), programs
// all six levels (spec 30), consumes every event with confidence/strength
// (T-PLAN-07), restrains every candidate (T-PLAN-05), validates on every
// compile (T-PLAN-10) and tags every cue with its spec 33 layer (T-PLAN-13).
import type { TrackModel } from "@autolight/contracts";
import { configHash, resolveConfig } from "./config.js";
import { breakdownCues, dropProgram, fakeDropHold } from "./contrast.js";
import { cueId } from "./corrections.js";
import { planTrackEvents } from "./events.js";
import {
  barCues,
  beatCues,
  CUE_LEVEL_ATTRIBUTES,
  findDropPlans,
  phraseCues,
  phraseStartsIn,
  stagedBuild,
  subBeatCues,
  trackArcPosition,
} from "./hierarchy.js";
import { planIdentity } from "./identity.js";
import { planRecurrence, summarizeSections } from "./recurrence.js";
import { freshRestraint, notePaletteChange, observeSection, restrain } from "./restraint.js";
import { hashValue, isPlanLayer, mulberry32, trackFingerprint, type CompiledShowPlan, type CompileInput, type CompileResult, type Oklch, type PlanCue, type PlannerConfigSnapshot, type PlannerStyle, type PlanLayer, type RejectedCandidate, type SectionPlan } from "./types.js";
import { diagnosticsOutOfBounds, evaluateCompiledPlan, validateCompiledPlan } from "./validate.js";
import { pickCandidate, type SectionCandidate } from "./scoring.js";
import { layerForCueName } from "./layers-fallback.js";

export const PLANNER_VERSION = "0.2.0";

function cueLevelOf(type: string): PlanCue["level"] {
  return CUE_LEVEL_ATTRIBUTES[type]?.level ?? "beat";
}

function styleHash(s: PlannerStyle): string {
  return hashValue(s);
}

function venueHash(v: CompileInput["venue"]): string {
  return hashValue(v);
}

type CueInit = {
  readonly type: string;
  readonly startBeat: number;
  readonly durationBeats: number;
  readonly intensity: number;
  readonly target: string;
  readonly priority: number;
  readonly color?: Oklch | undefined;
  readonly paletteRef?: string | undefined;
  readonly reason: string;
  readonly attack?: PlanCue["attack"] | undefined;
  readonly release?: PlanCue["release"] | undefined;
  readonly capability?: string | undefined;
};

function makeCue(
  seed: string,
  section: number,
  ordinal: { n: number },
  init: CueInit,
): PlanCue {
  const level = cueLevelOf(init.type);
  const layerName = layerForCueName(init.type);
  const layer: PlanLayer = isPlanLayer(layerName) ? layerName : "accents";
  const n = ordinal.n++;
  return {
    id: cueId(seed, section, level, n),
    type: init.type,
    startBeat: init.startBeat,
    durationBeats: init.durationBeats,
    intensity: Math.min(1, Math.max(0, init.intensity)),
    target: init.target,
    priority: init.priority,
    level,
    layer,
    ...(init.attack ? { attack: init.attack } : {}),
    ...(init.release ? { release: init.release } : {}),
    ...(init.color ? { color: init.color } : {}),
    ...(init.paletteRef ? { paletteRef: init.paletteRef } : {}),
    reason: init.reason,
    ...(init.capability ? { capability: init.capability } : {}),
  };
}

function sectionBpm(track: TrackModel): number {
  return track.beatGrid.beats[0]?.bpm ?? 128;
}

export function compileShow(input: CompileInput): CompileResult {
  const config = resolveConfig(input.config);
  const style = input.style;
  const venue = input.venue;
  const edits = input.edits;
  // Injected fingerprint resolver (T-ID-02 seam): the identity package maps
  // its SeedSource onto pcm/file/id; the default reads identity fields.
  // The raw fingerprint feeds the five-input seed, never a mixed seed.
  const fp = input.fingerprintOf ? input.fingerprintOf(input.track) : trackFingerprint(input.track);
  const sHash = styleHash(style);
  const vHash = venueHash(venue);
  const cHash = configHash(config);
  const seed = input.seedOverride ?? hashValue([fp.value, PLANNER_VERSION, sHash, vHash, cHash]);
  const rand = mulberry32(seed);
  const rejected: RejectedCandidate[] = [];
  const cues: PlanCue[] = [];
  const ordinal = { n: 0 };
  const deleted = new Set(edits?.deletedCueIds ?? []);
  const emit = (c: PlanCue): void => {
    if (!deleted.has(c.id)) cues.push(c);
  };

  const { design, core, sectionStarts } = planIdentity(input.track, style, config, seed);
  const summaries = summarizeSections(input.track.sections, config.sectionEnergy, core);
  const recurrence = planRecurrence(summaries, core, design.densityBaseline, config, seed);
  const drops = findDropPlans(input.track, config.dropMinConfidence);
  const dropByBeat = new Map(drops.map((d) => [d.impactBeat, d] as const));
  const dropOccurrence = new Map<number, number>();
  const fakeActuals = new Map<number, number>();
  for (const ev of input.track.musicalEvents) {
    if (ev.type === "fake-drop" && ev.endBeat !== undefined) {
      fakeActuals.set(ev.beat, ev.endBeat);
    }
  }
  const phraseStarts = input.track.sections.flatMap((s) => phraseStartsIn(s.startBeat, s.endBeat));
  void phraseStarts;
  const restraint = freshRestraint();
  const bpm = sectionBpm(input.track);
  const lastBeat = Math.max(16, ...input.track.sections.map((s) => s.endBeat));
  const firstBeat = Math.min(0, ...input.track.sections.map((s) => s.startBeat));

  const sections: SectionPlan[] = input.track.sections.map((s, idx) => {
    const kind = edits?.sectionKindOverrides[idx] ?? s.kind;
    const energy = Math.min(
      style.intensityRange[1],
      Math.max(style.intensityRange[0], config.sectionEnergy[kind] ?? 0.5),
    );
    return {
      index: idx,
      kind,
      startBeat: s.startBeat,
      endBeat: s.endBeat,
      look: kind === "breakdown" ? "breakdown-look" : "static-look",
      paletteRefs: [core[0] ? `core-0@${core[0].h}` : "core-0", "neutral"],
      movementFamily: design.movementVocabulary[idx % design.movementVocabulary.length] ?? "chase",
      brightnessRange: [Math.max(0, energy - 0.2), energy] as [number, number],
      density: design.densityBaseline,
      darkness: kind === "breakdown" ? 0.7 : style.darknessPreference * 0.5,
      groups: ["PRIMARY", "SECONDARY"],
      motifId: recurrence.motifOf[idx] ?? null,
      mixHints: {
        introBeats: 8,
        outroBeats: 8,
        incomingPalette: core.slice(0, 2),
        exclusiveImpactBeats: drops.filter((d) => d.impactBeat >= s.startBeat && d.impactBeat < s.endBeat).map((d) => d.impactBeat),
      },
    };
  });

  let candidateNo = 0;
  const perSection = Math.max(1, config.candidatesPerSection);
  input.track.sections.forEach((section, idx) => {
    const sec = sections[idx]!;
    const motifId = recurrence.motifOf[idx] ?? null;
    const occ = motifId ? recurrence.map.motifs.find((m) => m.id === motifId)!.sections.indexOf(idx) : 0;
    observeSection(restraint, section.startBeat);
    notePaletteChange(restraint, section.startBeat);
    const arc = trackArcPosition(section.startBeat, firstBeat, lastBeat);
    const energy = sec.brightnessRange[1]!;

    // Candidate hook (DS-19): build perSection variants, pick by mode.
    const variants: SectionCandidate[] = [];
    for (let v = 0; v < perSection; v++) {
      variants.push({
        index: v,
        cues: Math.max(1, Math.round((section.endBeat - section.startBeat) / 4)),
        meanIntensity: Math.min(1, energy * (1 + v * 0.03) * arc),
        darkness: sec.darkness,
        density: Math.min(1, design.densityBaseline + v * 0.05),
        variant: v,
        seed: `${seed}:${idx}:${v}`,
      });
    }
    const { winner, vetoed } = pickCandidate(variants, input.mode ?? "rules-with-veto");
    for (const v of vetoed) rejected.push({ candidate: candidateNo + v, reasons: ["pathological section candidate"] });
    const chosen = variants[winner] ?? variants[0]!;
    candidateNo += perSection;
    void chosen;

    const secStyle = { ...style, ...(edits?.sectionStyles[idx] ?? {}) };
    const drop = dropByBeat.get(section.startBeat) ?? null;
    void drop;

    // Section look with the track identity colour. The emitted type keeps
    // the legacy section-look spelling (a StaticLook alias) because the
    // mixer blackout probe and the renderer look for it; the motif
    // variation rides on the target, not the type. paletteChangeRate gates
    // mid-motif repaints, symmetry biases the target side, reactiveAmount
    // scales beat-pulse energy (the live overlay amount).
    const lookColour = core[idx % Math.max(1, core.length)] ?? core[0]!;
    const symmetricTarget = (occ % 2 === 0) ? "PRIMARY" : "SECONDARY";
    const lookTarget = style.symmetry > 0.75 ? "PRIMARY" : symmetricTarget;
    const repaint = style.paletteChangeRate > 0.55 && occ > 0 && idx % 2 === 1;
    const look = makeCue(seed, idx, ordinal, {
      type: "section-look",
      startBeat: section.startBeat,
      durationBeats: Math.max(0, section.endBeat - section.startBeat),
      intensity: energy * arc,
      target: lookTarget,
      priority: 10,
      color: repaint ? (core[(idx + 1) % Math.max(1, core.length)] ?? lookColour) : lookColour,
      paletteRef: `core-${idx % Math.max(1, core.length)}`,
      reason: motifId ? `section look in ${motifId} (colour ${lookColour.h})` : "section look",
    });
    emit(look);
    // darknessPreference is visible: a shade dip per section whose duration
    // scales with the preference, at mid-range intensity so style peaks
    // stay inside intensityRange.
    if (style.darknessPreference > 0.01) {
      const secLen = section.endBeat - section.startBeat;
      const shadeBeats = Math.min(secLen, 4 * style.darknessPreference);
      const [lo, hi] = style.intensityRange;
      emit(
        makeCue(seed, idx, ordinal, {
          type: "dip",
          startBeat: section.startBeat + Math.min(4, secLen / 2),
          durationBeats: Math.max(0, shadeBeats),
          intensity: Math.min(hi, Math.max(lo, (lo + hi) / 2)),
          target: "AMBIENT",
          priority: 35,
          reason: "darkness preference shade",
        }),
      );
    }
    if (sec.kind === "breakdown") {
      for (const b of breakdownCues(section.startBeat, section.endBeat, secStyle, config, core)) {
        emit(
          makeCue(seed, idx, ordinal, {
            type: b.type,
            startBeat: b.startBeat,
            durationBeats: b.durationBeats,
            intensity: Math.min(secStyle.intensityRange[1], b.intensity),
            target: "AMBIENT",
            priority: b.priority,
            color: b.color,
            reason: b.reason,
          }),
        );
      }
    }

    for (const p of phraseCues(section.startBeat, section.endBeat, motifId, Math.max(0, occ), core)) {
      emit(
        makeCue(seed, idx, ordinal, {
          type: p.type,
          startBeat: p.startBeat,
          durationBeats: p.durationBeats,
          intensity: Math.min(secStyle.intensityRange[1], p.intensity),
          target: p.target,
          priority: p.priority,
          reason: p.reason,
        }),
      );
    }
    for (const b of barCues(section.startBeat, section.endBeat, Math.max(2, config.chaseBasePeriodBeats / (0.5 + secStyle.spatialDensity)), energy)) {
      const r = restrain(restraint, "chase", b.startBeat, b.durationBeats, secStyle, config, {
        direction: b.target,
        family: "chase",
      });
      if (r.verdict.decision === "reject") {
        rejected.push({ candidate: candidateNo++, reasons: [r.verdict.reason] });
        continue;
      }
      emit(
        makeCue(seed, idx, ordinal, {
          type: r.verdict.decision === "substitute" ? "pulse" : b.type,
          startBeat: b.startBeat,
          durationBeats: b.durationBeats,
          intensity: Math.min(secStyle.intensityRange[1], b.intensity),
          target: b.target,
          priority: b.priority,
          reason: r.verdict.decision === "substitute" ? r.verdict.reason : b.reason,
        }),
      );
    }
    for (const b of beatCues(section.startBeat, section.endBeat, energy, secStyle.movementDensity)) {
      const scaled = b.intensity * (0.5 + secStyle.movementDensity * 0.5) * (0.7 + secStyle.reactiveAmount);
      emit(
        makeCue(seed, idx, ordinal, {
          type: b.type,
          startBeat: b.startBeat,
          durationBeats: b.durationBeats,
          intensity: Math.min(secStyle.intensityRange[1], scaled),
          target: b.target,
          priority: b.priority,
          reason: b.reason,
        }),
      );
    }
    const mover = sec.movementFamily;
    if (mover === "rotation" || mover === "fan" || mover === "converge" || mover === "diverge") {
      emit(
        makeCue(seed, idx, ordinal, {
          type: mover === "rotation" ? "orbit" : mover,
          startBeat: section.startBeat,
          durationBeats: Math.max(0, section.endBeat - section.startBeat),
          intensity: energy * 0.8,
          target: "PRIMARY",
          priority: 20,
          reason: `movement vocabulary ${mover}`,
          capability: mover === "rotation" ? "closed-loop" : undefined,
        }),
      );
    }

    // Drop programming: the section containing the impact owns the full
    // program (staged ramps, darkness, hit, burst, body), so each drop
    // fires once however many sections the build crosses.
    for (const d of drops) {
      if (d.impactBeat < section.startBeat || d.impactBeat >= section.endBeat) continue;
      const ev = input.track.musicalEvents.find((e) => e.type === "drop" && e.beat === d.impactBeat);
      const strength = ev?.strength ?? 0.8;
      const occCount = dropOccurrence.get(d.impactBeat) ?? 0;
      const prog = dropProgram(d.buildStart, d.impactBeat, strength * (0.5 + secStyle.impactAggression), occCount, secStyle, config, core, bpm);
      dropOccurrence.set(d.impactBeat, occCount + 1);
      for (const c of prog.cues) {
        if (c.type === "white-hit") {
          const moved = edits?.movedEvents[`drop@${d.impactBeat}`];
          const at = moved ?? c.startBeat;
          // whiteHitFrequency gates the draw: a failed draw lands a
          // full-colour impact through the same restraint path.
          const draw = ((at * 2654435761 + seed.length * 97) % 100) / 100;
          const forceImpact = draw >= secStyle.whiteHitFrequency;
          const r = forceImpact
            ? { state: restraint, verdict: { decision: "substitute", substitute: "impact", reason: "white-hit frequency draw favours a full-colour impact" } as const }
            : restrain(restraint, "white-hit", at, c.durationBeats, secStyle, config, { impact: true });
          if (r.verdict.decision === "reject") {
            rejected.push({ candidate: candidateNo++, reasons: [r.verdict.reason] });
            continue;
          }
          const useType = r.verdict.decision === "substitute" ? r.verdict.substitute : c.type;
          emit(
            makeCue(seed, idx, ordinal, {
              type: useType,
              startBeat: at,
              durationBeats: c.durationBeats,
              intensity: Math.min(secStyle.intensityRange[1], c.intensity),
              target: c.target,
              priority: c.priority,
              color: useType === "white-hit" ? c.color : core[0],
              reason: r.verdict.decision === "substitute" ? r.verdict.reason : c.reason,
              attack: { kind: "ms", ms: 5 },
              release: { kind: "beats", beats: 0.5 },
            }),
          );
        } else if (c.type === "blackout") {
          const r = restrain(restraint, "blackout", c.startBeat, c.durationBeats, secStyle, config);
          if (r.verdict.decision === "reject") {
            rejected.push({ candidate: candidateNo++, reasons: [r.verdict.reason] });
            continue;
          }
          emit(
            makeCue(seed, idx, ordinal, {
              type: r.verdict.decision === "substitute" ? r.verdict.substitute : c.type,
              startBeat: c.startBeat,
              durationBeats: c.durationBeats,
              intensity: 0,
              target: c.target,
              priority: c.priority,
              reason: r.verdict.decision === "substitute" ? r.verdict.reason : c.reason,
            }),
          );
        } else {
          emit(
            makeCue(seed, idx, ordinal, {
              type: c.type,
              startBeat: c.startBeat,
              durationBeats: c.durationBeats,
              intensity: Math.min(secStyle.intensityRange[1], c.intensity),
              target: c.target,
              priority: c.priority,
              color: c.color,
              reason: c.reason + (occCount > 0 ? " (second drop varies)" : ""),
            }),
          );
        }
      }
      // Foreshadowing: a brief glimpse of the drop motif in the build.
      emit(
        makeCue(seed, idx, ordinal, {
          type: "pulse",
          startBeat: Math.max(section.startBeat, d.impactBeat - 8),
          durationBeats: 0.5,
          intensity: Math.min(secStyle.intensityRange[1], 0.6),
          target: "SECONDARY",
          priority: 62,
          color: core[0],
          reason: "foreshadowing glimpse of the drop motif",
        }),
      );
    }

    // Staged build from hierarchy for builds without a detected drop.
    if (sec.kind === "build" && !drops.some((d) => d.buildStart >= section.startBeat && d.buildStart < section.endBeat)) {
      for (const b of stagedBuild(section.startBeat, section.endBeat, secStyle, config)) {
        emit(
          makeCue(seed, idx, ordinal, {
            type: b.type,
            startBeat: b.startBeat,
            durationBeats: b.durationBeats,
            intensity: Math.min(secStyle.intensityRange[1], b.intensity),
            target: b.target,
            priority: b.priority,
            reason: b.reason,
          }),
        );
      }
    }

    for (const s of subBeatCues(section.startBeat + 0.5, secStyle.strobeFrequency, () => (idx % 2 === 0 ? 0 : 1))) {
      const r = restrain(restraint, "strobe-burst", s.startBeat, s.durationBeats, secStyle, config);
      if (r.verdict.decision === "reject") {
        rejected.push({ candidate: candidateNo++, reasons: [r.verdict.reason] });
        continue;
      }
      emit(
        makeCue(seed, idx, ordinal, {
          type: "strobe-burst",
          startBeat: s.startBeat,
          durationBeats: s.durationBeats,
          intensity: Math.min(secStyle.intensityRange[1], s.intensity),
          target: "ALL",
          priority: s.priority,
          reason: s.reason,
          capability: "strobe",
        }),
      );
    }

    void dropByBeat;
    void sectionStarts;
  });

  // Event layer: every musical event becomes planning behaviour.
  const movedMap = edits?.movedEvents ?? {};
  for (const p of planTrackEvents(input.track, style, config, movedMap)) {
    if (p.cueType === "build-ramp" || p.cueType === "drop-pattern") continue;
    if (p.kind === "fake-hold") {
      const actual = fakeActuals.get(p.beat) ?? p.endBeat;
      for (const h of fakeDropHold(p.beat, actual)) {
        const r = restrain(restraint, "blackout", h.startBeat, h.durationBeats, style, config);
        if (r.verdict.decision === "reject") {
          rejected.push({ candidate: candidateNo++, reasons: [r.verdict.reason] });
          continue;
        }
        emit(
          makeCue(seed, 0, ordinal, {
            type: r.verdict.decision === "substitute" ? r.verdict.substitute : h.type,
            startBeat: h.startBeat,
            durationBeats: h.durationBeats,
            intensity: 0,
            target: h.target,
            priority: h.priority,
            reason: p.moved ? `moved event: ${h.reason}` : h.reason,
          }),
        );
      }
      continue;
    }
    if (p.cueType === "blackout" || p.cueType === "dip") {
      const r = restrain(restraint, p.cueType === "blackout" ? "blackout" : "dip", p.beat, p.durationBeats, style, config);
      if (r.verdict.decision === "reject") {
        rejected.push({ candidate: candidateNo++, reasons: [r.verdict.reason] });
        continue;
      }
    }
    if (p.cueType === "white-hit") {
      const r = restrain(restraint, "white-hit", p.beat, p.durationBeats, style, config, { impact: true });
      if (r.verdict.decision === "reject") {
        rejected.push({ candidate: candidateNo++, reasons: [r.verdict.reason] });
        continue;
      }
      if (r.verdict.decision === "substitute") {
        emit(
          makeCue(seed, 0, ordinal, {
            type: r.verdict.substitute,
            startBeat: p.beat,
            durationBeats: p.durationBeats,
            intensity: Math.min(style.intensityRange[1], p.intensity),
            target: "PRIMARY",
            priority: p.priority,
            color: core[0],
            reason: r.verdict.reason,
          }),
        );
        continue;
      }
    }
    emit(
      makeCue(seed, 0, ordinal, {
        type: p.cueType,
        startBeat: p.beat,
        durationBeats: p.durationBeats,
        intensity: Math.min(style.intensityRange[1], p.cueType === "blackout" ? 0 : p.intensity),
        target:
          p.cueType === "vocal-focus"
            ? "PRIMARY"
            : p.cueType === "fill-accent" || p.cueType === "bump"
              ? "SECONDARY"
              : p.cueType === "final-hit"
                ? "ALL"
                : "PRIMARY",
        priority: p.priority,
        color: p.cueType === "breakdown-look" || p.cueType === "static-look" ? core[0] : undefined,
        reason: p.moved ? `moved event: ${p.reason}` : p.reason,
      }),
    );
  }

  // Pinned cues and deletions from edits.
  if (edits) {
    for (const pin of edits.pinnedCues) {
      if (!deleted.has(pin.id) && !cues.some((c) => c.id === pin.id)) cues.push(pin);
    }
  }

  cues.sort((a, b) => a.startBeat - b.startBeat || b.priority - a.priority);

  const budgetsUsed: Record<string, number> = {
    impacts: restraint.wholeTrackImpactCount,
    blinderBeats: restraint.blinderBeats,
    strobeBeats: restraint.strobeBeats,
  };
  const budgetsRemaining: Record<string, number> = {
    impacts: Math.max(0, config.trackImpactMax - restraint.wholeTrackImpactCount),
    strobeBeats: Math.max(0, 32 - restraint.strobeBeats),
  };

  const plan: CompiledShowPlan = {
    schemaVersion: 1,
    plannerVersion: PLANNER_VERSION,
    trackId: input.track.identity.id,
    styleId: style.id,
    seed,
    cues,
    determinism: {
      fingerprint: fp.value,
      fingerprintSource: fp.source,
      plannerVersion: PLANNER_VERSION,
      styleHash: sHash,
      venueHash: vHash,
      configHash: cHash,
      seed,
    },
    globalDesign: design,
    sections,
    recurrence: recurrence.map,
    constraints: { budgetsUsed, budgetsRemaining },
  };

  const durationBeats = Math.max(16, ...input.track.sections.map((s) => s.endBeat), ...cues.map((c) => c.startBeat + c.durationBeats));
  const problems = validateCompiledPlan(plan, durationBeats, config, { venue });
  const diagnostics = evaluateCompiledPlan(plan, config);
  const outOfBounds = diagnosticsOutOfBounds(diagnostics, config);

  return { plan, diagnostics, rejected: [...rejected, ...problems.map((r) => ({ candidate: -1, reasons: [r] as readonly string[] })), ...outOfBounds.map((r) => ({ candidate: -1, reasons: [r] as readonly string[] }))] };
}

export { resolveConfig, DEFAULT_CONFIG } from "./config.js";
export type { PlannerConfigSnapshot };
