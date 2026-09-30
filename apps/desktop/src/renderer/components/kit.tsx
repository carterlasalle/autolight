// T-UI-01 spec 142 component library: the presentation layer built once with
// typed props, no page-specific copies, no timing, no I/O and no
// authoritative state inside components. Screens bind snapshot data to these
// props; components only render (S7). Every number shown is either passed in
// as measured/configured data or rendered as "unmeasured" (S6): no literal
// metrics live in component code.
import type { TrackModel, ShowCue } from "@autolight/contracts";
import { tokens } from "../tokens.js";
import type { DeviceTile as TileData } from "../venue.js";

// ---------------------------------------------------------------- status dot
export type StatusTone = "neutral" | "ok" | "warn" | "bad";

export function tokenForTone(tone: StatusTone): string {
  switch (tone) {
    case "ok": return tokens.statusOk;
    case "warn": return tokens.statusWarn;
    case "bad": return tokens.statusBad;
    default: return tokens.statusIdle;
  }
}

// StatusDot: semantic colour plus an explicit text label (no colour-only
// state). label is required so the colour never carries meaning alone.
export function StatusDot({ tone, label, title }: {
  tone: StatusTone;
  label: string;
  title?: string;
}): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5" title={title}>
      <span aria-hidden className="inline-block size-2 rounded-full" style={{ backgroundColor: tokenForTone(tone) }} />
      <span className={tokens.type.small}>{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------- metric badge
export interface Metric {
  label: string;
  value: string | null;
  unit: string;
}

// S6: a null value renders as an explicit "unmeasured", never a guessed
// number. This is the single formatting rule for measured values.
export function metricText(m: Metric): string {
  return m.value === null ? `${m.label}: unmeasured` : `${m.label}: ${m.value}${m.unit}`;
}

export function MetricBadge({ metric }: { metric: Metric }): JSX.Element {
  return <span className={tokens.type.timing + " " + tokens.type.small}>{metricText(metric)}</span>;
}

// ---------------------------------------------------------------- deck panel
export interface DeckData {
  title: string;
  subtitle: string;
  bpm: number | null;
  section: string | null;
  countdown: string | null;
  health: StatusTone;
}

export function deckBpm(bpm: number | null): string {
  return bpm === null ? "unmeasured" : bpm.toFixed(1);
}

// DeckPanel: one spec 90 deck card. Timing text is passed in pre-formatted
// (never computed or timed here).
export function DeckPanel({ deck, children }: { deck: DeckData; children?: React.ReactNode }): JSX.Element {
  return (
    <section aria-label={deck.title} className={tokens.panel}>
      <header className={tokens.space.paddingTight}>
        <h2 className={tokens.type.body}>{deck.title}</h2>
        <p className={tokens.type.small + " " + tokens.subtle}>{deck.subtitle}</p>
      </header>
      <div className={tokens.space.padding}>
        {deck.section !== null ? <p className={tokens.type.body + " " + tokens.accent}>{deck.section}</p> : null}
        {deck.countdown !== null ? <p className={tokens.type.timing + " " + tokens.type.body}>{deck.countdown}</p> : null}
        <StatusDot tone={deck.health} label={`deck health: ${deck.health}`} />
        <p className={tokens.type.small + " " + tokens.subtle}>BPM {deckBpm(deck.bpm)}</p>
        {children}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- waveform
export interface WaveformPoint {
  at: number; // position in measured source units
  value: number; // measured level, 0..1
}

// Waveform: mono summary path, rendered from measured points only. The
// polyline plus the playhead share one axis mapping; no timing inside.
export function Waveform({ points, beat }: { points: WaveformPoint[]; beat: number }): JSX.Element {
  const w = 240;
  const h = 48;
  const minAt = points.length > 0 ? Math.min(...points.map((p) => p.at)) : 0;
  const maxAt = points.length > 1 ? Math.max(...points.map((p) => p.at)) : minAt + 1;
  const span = maxAt - minAt;
  const x = (at: number): number => ((at - minAt) / span) * w;
  const d = points.map((p) => `${x(p.at)},${(1 - p.value) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Waveform" className="block h-12 w-full" preserveAspectRatio="none">
      {d.length > 0 ? <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1" /> : null}
      <line x1={String(x(beat))} x2={String(x(beat))} y1="0" y2={String(h)} stroke={tokens.accent} aria-hidden />
    </svg>
  );
}

// ---------------------------------------------------------------- beat ruler
export interface BeatTick {
  at: number;
}

// BeatRuler: bar and beat ticks on the shared timeline span.
export function BeatRuler({ ticks, startBeat, endBeat, beatsPerBar }: {
  ticks: BeatTick[];
  startBeat: number;
  endBeat: number;
  beatsPerBar: number;
}): JSX.Element {
  const span = Math.max(1, endBeat - startBeat);
  return (
    <div role="img" aria-label="Beat ruler" className="relative h-4 border-b border-border">
      {ticks.map((t) => {
        const isBar = (t.at - startBeat) % beatsPerBar === 0;
        const left = `${((t.at - startBeat) / span) * 100}%`;
        return (
          <span key={t.at} aria-hidden className={isBar ? "absolute h-3 w-px bg-foreground" : "absolute h-1.5 w-px bg-muted-foreground"} style={{ left }} />
        );
      })}
    </div>
  );
}

export function barTicks(startBeat: number, endBeat: number): BeatTick[] {
  const ticks: BeatTick[] = [];
  for (let b = Math.ceil(startBeat); b <= endBeat; b++) ticks.push({ at: b });
  return ticks;
}

// ---------------------------------------------------------------- lanes
export interface LaneMark {
  at: number;
  label: string;
  kind: "section" | "event" | "cue";
}

export interface SectionBand {
  start: number;
  end: number;
  label: string;
}

// SectionLane: structural sections over the shared timeline span.
export function SectionLane({ bands, startBeat, endBeat }: {
  bands: SectionBand[];
  startBeat: number;
  endBeat: number;
}): JSX.Element {
  const span = Math.max(1, endBeat - startBeat);
  return (
    <div role="img" aria-label="Sections" className="relative h-6 border-b border-border">
      {bands.map((s) => {
        const left = ((s.start - startBeat) / span) * 100;
        const width = Math.max(0.5, ((s.end - s.start) / span) * 100);
        return (
          <span key={s.start} aria-hidden className="absolute top-0 h-6 bg-muted" style={{ left: `${left}%`, width: `${width}%` }}>
            <span className="overflow-hidden px-1 text-[10px]">{s.label}</span>
          </span>
        );
      })}
    </div>
  );
}

// EventLane: marked beats in one row (events and cues are both marks here).
export function EventLane({ marks, startBeat, endBeat }: {
  marks: LaneMark[];
  startBeat: number;
  endBeat: number;
}): JSX.Element {
  const span = Math.max(1, endBeat - startBeat);
  return (
    <div role="img" aria-label="Events" className="relative h-5">
      {marks.map((m) => {
        const left = ((m.at - startBeat) / span) * 100;
        const tone = m.kind === "cue" ? tokens.statusWarn : m.kind === "event" ? tokens.statusOk : tokens.accent;
        return (
          <span key={`${m.kind}-${m.at}`} title={m.label} aria-hidden
            className="absolute top-1/2 size-2 -translate-y-1/2"
            style={{ left: `${left}%`, backgroundColor: tone }} />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- fixture preview
export interface FixtureCellGrid {
  cells: { x: number; color: string }[];
}

// FixturePreview: the WP05 room view. 2,000 cells render as rects inside one
// svg per fixture row (never a div per cell), so the room stays cheap enough
// for the 60 fps trace in T-UI-13.
export function FixturePreview({ rows, rowHeight = 16 }: {
  rows: FixtureCellGrid[];
  rowHeight?: number;
}): JSX.Element {
  const h = Math.max(4, rowHeight);
  return (
    <div role="img" aria-label="Venue preview" className="flex flex-col gap-1">
      {rows.map((row, i) => {
        const width = row.cells.reduce((max, c) => Math.max(max, c.x + 1), 1);
        return (
          <svg key={i} viewBox={`0 0 ${width} ${h}`} className="block h-4 w-full" preserveAspectRatio="none" role="presentation">
            {row.cells.map((c) => <rect key={c.x} x={String(c.x)} y="0" width="1" height={String(h)} fill={c.color} />)}
          </svg>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- device tile
// HealthIndicator: health word plus tone; callsites pass their own label.
export function HealthIndicator({ tone, label }: { tone: StatusTone; label: string }): JSX.Element {
  return <StatusDot tone={tone} label={label} />;
}

// DeviceTile: one spec 99 device tile. Values are measured (or unmeasured)
// props; the caller wires buttons to typed intents.
export function DeviceTile({ tile, onAction }: {
  tile: TileData;
  onAction?: (action: "IDENTIFY" | "TEST CHASE" | "RECALIBRATE") => void;
}): JSX.Element {
  const healthTone: StatusTone = tile.health === "online" ? "ok" : tile.health === "degraded" ? "warn" : "bad";
  return (
    <article aria-label={tile.id} className={tokens.panel}>
      <header className={tokens.space.paddingTight}>
        <h3 className={tokens.type.body}>{tile.id} <span className={tokens.subtle}>({tile.sku})</span></h3>
        <HealthIndicator tone={healthTone} label={`health: ${tile.health}`} />
      </header>
      <div className={tokens.space.padding}>
        <MetricBadge metric={{ label: "latency", value: String(tile.latencyMs), unit: "ms" }} />
        <p className={tokens.type.small + " " + tokens.subtle}>
          {tile.segments !== 0 ? `${tile.segments} segments` : "segments: unmeasured"} · {tile.ip ?? "no IP"}
        </p>
        {onAction !== undefined && (
          <div className={tokens.space.gapTight}>
            {(["IDENTIFY", "TEST CHASE", "RECALIBRATE"] as const).map((a) => (
              <button key={a} type="button" className={tokens.motion.hover} onClick={() => onAction(a)}>{a}</button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------- inspector
// InspectorPanel: synchronized lanes (spec 96) driven straight from the
// installed TrackModel: sections as bands, musical events and cues as
// marks, grid from the beat grid. The one place a track becomes lanes.
export function InspectorPanel({ track, startBeat, endBeat }: {
  track: TrackModel;
  startBeat: number;
  endBeat: number;
}): JSX.Element {
  const bands: SectionBand[] = track.sections.map((s) => ({ start: s.startBeat, end: s.endBeat, label: s.kind }));
  const marks: LaneMark[] = track.musicalEvents.map((e) => ({ at: e.beat, label: e.type, kind: "event" }));
  return (
    <section aria-label="Track inspector" className={tokens.panel}>
      <header className={tokens.space.paddingTight}>
        <h2 className={tokens.type.body}>{track.identity.title ?? track.identity.id}</h2>
      </header>
      <SectionLane bands={bands} startBeat={startBeat} endBeat={endBeat} />
      <BeatRuler ticks={barTicks(startBeat, endBeat)} startBeat={startBeat} endBeat={endBeat} beatsPerBar={4} />
      <EventLane marks={marks} startBeat={startBeat} endBeat={endBeat} />
      <div className="flex flex-wrap gap-1">
        {track.beatGrid.beats.slice(0, 16).map((b) => (
          <span key={b.index} className={tokens.type.timing + " " + tokens.type.caption}>{String(b.beatInBar)}</span>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- timeline cursor
// TimelineCursor: a playhead over a measured timeline; position is a prop.
export function TimelineCursor({ at, end }: { at: number; end: number }): JSX.Element {
  const left = end > 0 ? `${Math.min(100, Math.max(0, (at / end) * 100))}%` : "0%";
  return <span role="img" aria-label="Playhead" aria-hidden className="absolute top-0 bottom-0 w-px bg-primary" style={{ left }} />;
}

// ---------------------------------------------------------------- cue list
export interface CueRow {
  cue: ShowCue;
  now: number; // measured master beat, not advanced here
  onSelect?: (cue: ShowCue) => void;
}

export function cueRelative(cue: ShowCue, now: number): string {
  const delta = Math.max(0, Math.round(cue.startBeat - now));
  return delta === 0 ? "in now" : `in ${delta} beats`;
}

// CueList: upcoming cues per deck (spec 93) with relative timing.
export function CueList({ cues, now }: { cues: CueRow[]; now: number }): JSX.Element {
  return (
    <ol role="list" aria-label="Upcoming cues">
      {cues.map((row) => (
        <li key={`${row.cue.startBeat}-${row.cue.target}`} className={tokens.panel + " " + tokens.space.paddingTight}>
          <span>{row.cue.type.replace(/-/g, " ")} → {row.cue.target}</span>
          <span className={tokens.type.timing + " " + tokens.accent}>{cueRelative(row.cue, now)}</span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- master controls
export interface MasterState {
  intensity: number | null;
  frozen: boolean;
  blackout: boolean;
  auto: boolean;
}

export function masterIntensity(intensity: number | null): string {
  return intensity === null ? "unmeasured" : `${Math.round(intensity * 100)}%`;
}

// MasterControls: emergency bar (spec 94). Real values from the show host
// arrive as props; the same intents as the B/W/F/A shortcut keys.
export function MasterControls({ state, onIntent }: {
  state: MasterState;
  onIntent: (intent: "blackout" | "full" | "freeze" | "resume") => void;
}): JSX.Element {
  const labels: Record<"blackout" | "full" | "freeze" | "resume", string> = {
    blackout: state.blackout ? "blackout on" : "blackout",
    full: "full white",
    freeze: state.frozen ? "frozen" : "freeze",
    resume: state.auto ? "auto" : "manual",
  };
  return (
    <div role="toolbar" aria-label="Master" className={tokens.space.gap}>
      {(["blackout", "full", "freeze", "resume"] as const).map((i) => (
        <button key={i} type="button" onClick={() => onIntent(i)}>{labels[i]}</button>
      ))}
      <span className={tokens.type.timing + " " + tokens.type.small}>intensity {masterIntensity(state.intensity)}</span>
    </div>
  );
}

// ---------------------------------------------------------------- config field
export interface ConfigValue {
  key: string;
  value: string;
  unit: string;
  range: string;
  receipt: string;
  liveSafe: boolean;
}

export function receiptLabel(receipt: string): "spec" | "measured" | "unmeasured" | "other" {
  if (receipt.startsWith("spec")) return "spec";
  if (receipt.startsWith("measured")) return "measured";
  if (receipt.startsWith("unmeasured")) return "unmeasured";
  return "other";
}

// ConfigField: renders any config key with value, unit, range, receipt and a
// live-safe badge (owner requirement: every configuration visible).
export function ConfigField({ def }: { def: ConfigValue }): JSX.Element {
  const receipt = receiptLabel(def.receipt);
  const receiptTone: StatusTone = receipt === "unmeasured" ? "warn" : receipt === "measured" ? "ok" : "neutral";
  return (
    <div className={tokens.space.gapTight}>
      <code className={tokens.type.body}>{def.key}</code>
      <BadgeSpan label={`receipt: ${receipt}`} tone={receiptTone} />
      {def.liveSafe ? <BadgeSpan label="live-safe" tone="ok" /> : <BadgeSpan label="restart-safe" tone="neutral" />}
      <p className={tokens.type.small + " " + tokens.subtle}>
        value {def.value} · {def.unit}{def.range.length > 0 ? ` (${def.range})` : ""}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- decision switch
export type DecisionMode = { id: string; label: string; measurement: string };
export interface Decision {
  id: string;
  current: string;
  modes: DecisionMode[];
}

// DecisionSwitch: DS selector with every mode and its measurements shown.
export function DecisionSwitch({ decision, onPick }: {
  decision: Decision;
  onPick?: (mode: string) => void;
}): JSX.Element {
  return (
    <div role="radiogroup" aria-label={decision.id} className={tokens.space.gap}>
      {decision.modes.map((mode) => {
        const current = mode.id === decision.current;
        return (
          <label key={mode.id} className={tokens.panel + " " + tokens.space.paddingTight}>
            <input type="radio" name={decision.id} checked={current} onChange={() => onPick && onPick(mode.id)} disabled={onPick === undefined} />
            <span className={tokens.type.body}>{mode.label}</span>
            <span className={tokens.type.small + " " + tokens.subtle}>{mode.measurement}</span>
            {current ? <BadgeSpan label="current" tone="ok" /> : null}
          </label>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- capability badge
// The capability status vocabulary (00-agent-briefing 5.1a): only truthful
// states pass in; the badge never invents a status.
export type CapabilityStatus = "PASS" | "IMPLEMENTED_UNQUALIFIED" | "PARTIAL" | "FAIL" | "UNAVAILABLE_ON_THIS_DEVICE" | "MISSING";
export const CAPABILITY_STATUSES: readonly CapabilityStatus[] = [
  "PASS", "IMPLEMENTED_UNQUALIFIED", "PARTIAL", "FAIL", "UNAVAILABLE_ON_THIS_DEVICE", "MISSING",
];

export function CapabilityBadge({ capability, status }: { capability: string; status: CapabilityStatus }): JSX.Element {
  const tone: StatusTone = status === "PASS" ? "ok" : status === "PARTIAL" || status === "IMPLEMENTED_UNQUALIFIED" ? "warn" : "bad";
  return <BadgeSpan label={`${capability}: ${status}`} tone={tone} />;
}

// ---------------------------------------------------------------- source badge
export interface SourceInfo {
  source: "REKORDBOX" | "SERATO";
  provider: string;
  verified: boolean;
}

// SourceBadge: source, provider and quality (spec 89). The unverified copy
// is exactly the spec 145 banner wording.
export function SourceBadge({ info }: { info: SourceInfo }): JSX.Element {
  const quality = info.verified ? "verified" : UNVERIFIED_REKORDBOX_COPY;
  return (
    <BadgeSpan label={`${info.source} ${info.provider} ${quality}`} tone={info.verified ? "ok" : "warn"} />
  );
}

export const UNVERIFIED_REKORDBOX_COPY = "UNVERIFIED REKORDBOX VERSION";

// ---------------------------------------------------------------- shared badge
function BadgeSpan({ label, tone }: { label: string; tone: StatusTone }): JSX.Element {
  return (
    <span className={tokens.type.small + " " + tokens.panel}>
      <span aria-hidden className="inline-block size-1.5 rounded-full" style={{ backgroundColor: tokenForTone(tone) }} />
      {label}
    </span>
  );
}