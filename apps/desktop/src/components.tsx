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
export function DeckPanel({ deck, title }: { deck: number; title: string }): JSX.Element {
  return <section aria-label={title}><h2>{title}</h2><p>Deck {deck}</p></section>;
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
export function UpcomingCues({ cues }: { cues: ShowCue[] }): JSX.Element {
  return (
    <ol aria-label="Upcoming cues">
      {cues.slice(0, 5).map((c, i) => (
        <li key={i}>{c.startBeat}: {c.type} ({c.target})</li>
      ))}
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
export function MasterControls(): JSX.Element {
  return (
    <div role="toolbar" aria-label="Master">
      {["BLACKOUT", "FULL", "FREEZE", "AUTO"].map((a) => (
        <button key={a} type="button">{a}</button>
      ))}
    </div>
  );
}
export const _r = React;
