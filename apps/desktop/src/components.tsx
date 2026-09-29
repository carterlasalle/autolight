import React from "react";
export function StatusDot({ ok, label }: { ok: boolean; label: string }): JSX.Element {
  return <span role="status" aria-label={label}>{ok ? "●" : "○"} {label}</span>;
}
export function MetricBadge({ name, value }: { name: string; value: string }): JSX.Element {
  return <span><strong>{name}</strong> {value}</span>;
}
export function DeckPanel({ deck, title }: { deck: number; title: string }): JSX.Element {
  return <section aria-label={title}><h2>{title}</h2><p>Deck {deck}</p></section>;
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
