import React from "react";
import type { ShowCue } from "@autolight/contracts";
import type { LibraryRow, InspectorLane } from "./library.js";
import type { DeviceTile } from "./venue.js";

export function StatusDot({ ok, label }: { ok: boolean; label: string }): JSX.Element {
  return <span role="status" aria-label={label}>{ok ? "●" : "○"} {label}</span>;
}
export function MetricBadge({ name, value }: { name: string; value: string }): JSX.Element {
  return <span><strong>{name}</strong> {value}</span>;
}
export function DeckPanel({ deck, title, section, countdown }: {
  deck: number; title: string; section: string | undefined; countdown: string | undefined;
}): JSX.Element {
  return (
    <section className="deck-card" aria-label={title}>
      <h2>{title}</h2>
      <p className="deck-sub">Deck {deck}</p>
      {section ? <p className="deck-section">{section}</p> : null}
      {countdown ? <p className="deck-countdown">{countdown}</p> : null}
    </section>
  );
}
// Venue preview = exact logical output pre-calibration (§92): one swatch per cell.
export function VenuePreview({ cells }: { cells: { x: number; color: string }[] }): JSX.Element {
  return (
    <div role="img" aria-label="Venue preview">
      {cells.map((c, i) => (
        <span key={i} data-x={c.x} style={{ backgroundColor: c.color }} />
      ))}
    </div>
  );
}
// Upcoming cues (§93): next musical intents so the operator trusts the automation.
export function UpcomingCues({ cues, beat }: { cues: ShowCue[]; beat: number | undefined }): JSX.Element {
  const now = beat ?? 0;
  return (
    <ol aria-label="Upcoming cues">
      {cues.slice(0, 5).map((c, i) => {
        const delta = Math.max(0, Math.round(c.startBeat - now));
        const label = c.type.replace(/-/g, " ");
        return (
          <li key={i}>
            <span>{label} → {c.target}</span>
            <span className="cue-in">{delta === 0 ? "now" : `+${delta}`}</span>
          </li>
        );
      })}
    </ol>
  );
}
// Library screen (§95): playlists/crates left, readiness table main.
export function LibraryScreen({ rows }: { rows: LibraryRow[] }): JSX.Element {
  return (
    <table aria-label="Library">
      <thead><tr><th>Track</th><th>Artist</th><th>BPM</th><th>Status</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.trackId}><td>{r.title}</td><td>{r.artist}</td><td>{r.bpm ?? "—"}</td><td>{r.status}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
// Track Inspector (§96): synchronized lanes; click a beat to audition.
export function InspectorScreen({ lanes, onAudition }: { lanes: InspectorLane[]; onAudition: (beat: number) => void }): JSX.Element {
  void onAudition;
  return (
    <div aria-label="Track inspector">
      {lanes.map((l) => (
        <div key={l.name} aria-label={l.name}>{l.beats.map((b, i) => (
          <button key={i} type="button" onClick={() => onAudition(i)}>{String(b ?? "·")}</button>
        ))}</div>
      ))}
    </div>
  );
}
// Device screen (§99): tile per fixture + IDENTIFY/TEST CHASE/RECALIBRATE.
export function DeviceScreen({ tiles, onAction }: { tiles: DeviceTile[]; onAction: (id: string, action: string) => void }): JSX.Element {
  return (
    <div aria-label="Devices">
      {tiles.map((t) => (
        <section key={t.id} aria-label={t.id}>
          <h3>{t.id} ({t.sku})</h3>
          <p>{t.health} · {t.fps}fps · {t.segments} segs · {t.latencyMs}ms</p>
          {(["IDENTIFY", "TEST CHASE", "RECALIBRATE"] as const).map((a) => (
            <button key={a} type="button" onClick={() => onAction(t.id, a)}>{a}</button>
          ))}
        </section>
      ))}
    </div>
  );
}
// Setup wizard (§100): step list with current position, no modals.
export function SetupWizard({ steps, done }: { steps: readonly string[]; done: string[] }): JSX.Element {
  return (
    <ol aria-label="Setup">
      {steps.map((s) => (
        <li key={s} aria-current={done.length === steps.indexOf(s) ? "step" : undefined}>
          {done.includes(s) ? "✓ " : ""}{s}
        </li>
      ))}
    </ol>
  );
}
// Diagnostics (§101): tab bar + panel; status only, never interrupts Live (§144).
export function DiagnosticsPanel({ tabs, active }: { tabs: string[]; active: string }): JSX.Element {
  return (
    <div aria-label="Diagnostics">
      <div role="tablist">{tabs.map((t) => (
        <span key={t} role="tab" aria-selected={t === active}>{t}</span>
      ))}</div>
    </div>
  );
}
export function MasterControls({ onAction }: { onAction: ((action: string) => void) | undefined } = { onAction: undefined }): JSX.Element {
  return (
    <div role="toolbar" aria-label="Master">
      {["BLACKOUT", "FULL", "FREEZE", "AUTO"].map((a) => (
        <button key={a} type="button" className={a === "BLACKOUT" ? "danger" : undefined} onClick={() => onAction?.(a)}>{a}</button>
      ))}
    </div>
  );
}
// LED-party port: color swatches + brightness + blackout/hold (§88 manual lane).
export const PARTY_SWATCHES: [string, [number, number, number]][] = [
  ["Red", [255, 0, 0]], ["Green", [0, 255, 0]], ["Blue", [0, 0, 255]],
  ["White", [255, 255, 255]], ["Warm", [255, 180, 120]],
  ["ND Blue", [12, 36, 150]], ["Gold", [255, 200, 0]],
  ["Purple", [170, 0, 255]], ["Cyan", [0, 255, 255]], ["Amber", [255, 120, 0]],
];
export function ColorPanel({ onPick, onBlackout, onWhiteHold }: {
  onPick: (rgb: [number, number, number]) => void;
  onBlackout: () => void;
  onWhiteHold: (down: boolean) => void;
}): JSX.Element {
  return (
    <section aria-label="Color & Brightness">
      <h3 className="panel-title">Color + brightness</h3>
      <div role="group" aria-label="Swatches">
        {PARTY_SWATCHES.map(([name, rgb]) => (
          <button
            key={name}
            type="button"
            aria-label={name}
            title={name}
            style={{ backgroundColor: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` }}
            onClick={() => onPick(rgb)}
          />
        ))}
      </div>
      <button type="button" onClick={onBlackout}>Blackout</button>
      <button
        type="button"
        onMouseDown={() => onWhiteHold(true)}
        onMouseUp={() => onWhiteHold(false)}
      >
        White (Hold)
      </button>
    </section>
  );
}
// LED-party port: flash-on-beat static/cycle + live color tracking.
// Pure presentational state lives in the parent; this panel only emits intents.
export type FlashMode = "static" | "cycle";
export function FlashPanel({ enabled, mode, onToggle, onMode }: {
  enabled: boolean;
  mode: FlashMode;
  onToggle: (on: boolean) => void;
  onMode: (mode: FlashMode) => void;
}): JSX.Element {
  return (
    <section aria-label="Color Flash on Beat">
      <h3 className="panel-title">Flash on beat</h3>
      <label><input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} /> Enable Flash on Beat</label>
      <div role="radiogroup" aria-label="Flash mode">
        {(["static", "cycle"] as const).map((m) => (
          <label key={m}>
            <input type="radio" name="flash-mode" checked={mode === m} onChange={() => onMode(m)} />
            {m === "static" ? "Static Color" : "Cycle Colors (Rainbow)"}
          </label>
        ))}
      </div>
    </section>
  );
}
export function LiveColorPanel({ active, onToggle, onOpen }: {
  active: boolean;
  onToggle: (on: boolean) => void;
  onOpen: () => void;
}): JSX.Element {
  return (
    <section aria-label="Live Color Wheel">
      <h3 className="panel-title">Live color</h3>
      <label><input type="checkbox" checked={active} onChange={(e) => onToggle(e.target.checked)} /> Enable Live Color Wheel</label>
      <button type="button" onClick={onOpen}>Open Color Wheel (updates live!)</button>
    </section>
  );
}
// LED-party port: manual energy tier + build/drop triggers + sensitivity.
// Parent maps these intents onto the show runtime (override/freeze/resume).
export type EnergyTier = "LOW" | "MED" | "HIGH";
export function ManualPanel({ manual, onMode, onTier, onTrigger, sensitivity, onSensitivity }: {
  manual: boolean;
  onMode: (manual: boolean) => void;
  onTier: (tier: EnergyTier) => void;
  onTrigger: (kind: "build" | "drop") => void;
  sensitivity: number;
  onSensitivity: (v: number) => void;
}): JSX.Element {
  return (
    <section aria-label="Manual Control & Sensitivity">
      <h3 className="panel-title">Manual control</h3>
      <div role="radiogroup" aria-label="Mode">
        <label><input type="radio" name="ctl-mode" checked={!manual} onChange={() => onMode(false)} /> Automatic</label>
        <label><input type="radio" name="ctl-mode" checked={manual} onChange={() => onMode(true)} /> Manual Override</label>
      </div>
      <div role="group" aria-label="Manual Energy Tier">
        {(["LOW", "MED", "HIGH"] as const).map((t) => (
          <button key={t} type="button" disabled={!manual} onClick={() => onTier(t)}>{t}</button>
        ))}
      </div>
      <div role="group" aria-label="Manual Triggers">
        <button type="button" onClick={() => onTrigger("build")}>Trigger Build</button>
        <button type="button" onClick={() => onTrigger("drop")}>Trigger Drop</button>
      </div>
      <label>Sensitivity: {sensitivity.toFixed(1)}x
        <input
          type="range" min={0.5} max={2} step={0.1} value={sensitivity}
          onChange={(e) => onSensitivity(Number(e.target.value))}
        />
      </label>
    </section>
  );
}
// LED-party port: A/B alternating patterns + speed. Parent owns the timer.
export const ALT_PATTERNS = [
  "Alternating Flash",
  "Alternating On/Off",
  "Alternating Colors",
  "Chase (A→B→A→B)",
  "Opposite Colors",
] as const;
export type AltPattern = (typeof ALT_PATTERNS)[number];
export function AlternatingPanel({ enabled, pattern, speedMs, onToggle, onPattern, onSpeed }: {
  enabled: boolean;
  pattern: AltPattern;
  speedMs: number;
  onToggle: (on: boolean) => void;
  onPattern: (p: AltPattern) => void;
  onSpeed: (ms: number) => void;
}): JSX.Element {
  return (
    <section aria-label="Alternating Light Effects (A/B)">
      <h3 className="panel-title">Alternating A/B</h3>
      <label><input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} /> Enable Alternating Mode</label>
      <label>Pattern:
        <select value={pattern} onChange={(e) => onPattern(e.target.value as AltPattern)}>
          {ALT_PATTERNS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label>Speed: {speedMs}ms
        <input
          type="range" min={100} max={2000} step={50} value={speedMs}
          onChange={(e) => onSpeed(Number(e.target.value))}
        />
      </label>
    </section>
  );
}
// LED-party port: audio input select + BPM + start/stop + 5s debug.
export function AudioPanel({ devices, device, bpm, onDevice, onStart, onStop, onDebug }: {
  devices: { index: number; name: string }[];
  device: number | null;
  bpm: number | null;
  onDevice: (index: number) => void;
  onStart: () => void;
  onStop: () => void;
  onDebug: () => void;
}): JSX.Element {
  return (
    <section aria-label="Audio Sync">
      <h3 className="panel-title">Audio sync</h3>
      <label>Input Device:
        <select value={device ?? ""} onChange={(e) => onDevice(Number(e.target.value))}>
          <option value="" disabled>Select input…</option>
          {devices.map((d) => <option key={d.index} value={d.index}>{d.name}</option>)}
        </select>
      </label>
      <p>BPM: {bpm !== null ? bpm.toFixed(1) : "--"}</p>
      <button type="button" onClick={onStart}>Start Audio Sync</button>
      <button type="button" onClick={onStop}>Stop Audio Sync</button>
      <button type="button" onClick={onDebug}>Audio Debug (5s)</button>
    </section>
  );
}
// LED-party port: style + palette + phrase blinder + start/stop.
// Styles map to BUILT_IN_STYLES; palettes are planner color stories (§28-29).
export const PARTY_PALETTES = ["ND", "Warm", "Cool", "Neon", "Fire", "Ocean", "UV"] as const;
export type PartyPalette = (typeof PARTY_PALETTES)[number];
export function AutoloopsPanel({ style, palette, blinder, running, onStyle, onPalette, onBlinder, onStart, onStop }: {
  style: string;
  palette: PartyPalette;
  blinder: boolean;
  running: boolean;
  onStyle: (s: string) => void;
  onPalette: (p: PartyPalette) => void;
  onBlinder: (on: boolean) => void;
  onStart: () => void;
  onStop: () => void;
}): JSX.Element {
  return (
    <section aria-label="Live Autoloops">
      <h3 className="panel-title">Autoloops show</h3>
      <label>Style:
        <select value={style} onChange={(e) => onStyle(e.target.value)}>
          {["House", "EDM", "Hip-Hop", "Chill"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label>Palette:
        <select value={palette} onChange={(e) => onPalette(e.target.value as PartyPalette)}>
          {PARTY_PALETTES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label><input type="checkbox" checked={blinder} onChange={(e) => onBlinder(e.target.checked)} /> Blinder on phrase (8 bars)</label>
      {!running
        ? <button type="button" onClick={onStart}>Start Live Autoloops</button>
        : <button type="button" onClick={onStop}>Stop Live Autoloops</button>}
    </section>
  );
}
// LED-party port: A/B assignment + target radio (A / B / Both).
export type LightTarget = "A" | "B" | "Both";
export function DiscoveryPanel({ devices, target, labelA, labelB, onScan, onAssign, onTarget }: {
  devices: { address: string; name: string }[];
  target: LightTarget;
  labelA: string;
  labelB: string;
  onScan: () => void;
  onAssign: (slot: "A" | "B") => void;
  onTarget: (t: LightTarget) => void;
}): JSX.Element {
  return (
    <section aria-label="Discover & Connect">
      <h3 className="panel-title">Lights</h3>
      <button type="button" onClick={onScan}>Scan</button>
      <select aria-label="Discovered devices">
        {devices.length === 0 && <option value="">(No devices found)</option>}
        {devices.map((d) => <option key={d.address} value={d.address}>{d.name} — {d.address}</option>)}
      </select>
      <button type="button" onClick={() => onAssign("A")}>Assign → A</button>
      <button type="button" onClick={() => onAssign("B")}>Assign → B</button>
      <p>A: {labelA} · B: {labelB}</p>
      <div role="radiogroup" aria-label="Control target">
        {(["A", "B", "Both"] as const).map((t) => (
          <label key={t}>
            <input type="radio" name="target" checked={target === t} onChange={() => onTarget(t)} />
            {t === "Both" ? "Control Both" : `Control ${t}`}
          </label>
        ))}
      </div>
    </section>
  );
}
export const _r = React;
