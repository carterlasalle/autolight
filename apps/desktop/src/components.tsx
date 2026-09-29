import React from "react";
import type { ShowCue } from "@autolight/contracts";

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
