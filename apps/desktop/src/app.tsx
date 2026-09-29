import { StatusDot, DeckPanel, MasterControls, UpcomingCues, VenuePreview } from "./components.js";
import type { ShowCue } from "@autolight/contracts";

export interface LiveState {
  source: "REKORDBOX" | "SERATO";
  bpm: number;
  deckA: { title: string; section: string; countdown: string };
  deckB: { title: string; section: string; countdown: string };
  cues: ShowCue[];
  cells: { x: number; color: string }[];
}

// Live screen (§89): status bar → decks + master clock → waveform →
// venue preview + upcoming cues → emergency controls. No modals (§144).
export function App({ live }: { live?: LiveState }): JSX.Element {
  const cues = live?.cues ?? [];
  const cells = live?.cells ?? [];
  return (
    <main>
      <StatusDot ok label={live?.source ?? "REKORDBOX"} />
      <DeckPanel deck={1} title={live?.deckA.title ?? "Deck A"} />
      <DeckPanel deck={2} title={live?.deckB.title ?? "Deck B"} />
      <p role="timer">{live?.bpm.toFixed(2) ?? "128.00"}</p>
      <VenuePreview cells={cells} />
      <UpcomingCues cues={cues} />
      <MasterControls />
    </main>
  );
}
