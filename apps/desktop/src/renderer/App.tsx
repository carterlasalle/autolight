import { StatusDot, DeckPanel, MasterControls, UpcomingCues, VenuePreview } from "./components.js";
import type { ShowCue } from "@autolight/contracts";

export interface LiveState {
  source: "REKORDBOX" | "SERATO";
  bpm: number;
  beat: number | undefined;
  deckA: { title: string; section: string | undefined; countdown: string | undefined };
  deckB: { title: string; section: string | undefined; countdown: string | undefined };
  cues: ShowCue[];
  cells: { x: number; color: string }[];
}

// Live screen (§89): status bar → decks + master clock → venue + upcoming →
// emergency bar. Waveform/additional lanes arrive with TrackModel wiring;
// panels below the fold hold manual controls. No modals (§144).
export function App({ live, onMaster }: { live: LiveState | undefined; onMaster: ((action: string) => void) | undefined }): JSX.Element {
  const cues = live?.cues ?? [];
  const cells = live?.cells ?? [];
  return (
    <main>
      <div className="statusbar">
        <StatusDot ok label={live?.source ?? "REKORDBOX"} />
        <span>Timing ●</span>
        <span>Govee 4/4</span>
      </div>
      <div className="live-grid">
        <DeckPanel deck={1} title={live?.deckA.title ?? "Deck A"} section={live?.deckA.section} countdown={live?.deckA.countdown} />
        <div className="clock-card">
          <p role="timer">{live?.bpm.toFixed(2) ?? "128.00"}</p>
          <span className="bpm-label">BPM</span>
        </div>
        <DeckPanel deck={2} title={live?.deckB.title ?? "Deck B"} section={live?.deckB.section} countdown={live?.deckB.countdown} />
      </div>
      <div className="venue-row">
        <div className="venue-card">
          <h3 className="card-title">Live venue preview</h3>
          <VenuePreview cells={cells} />
        </div>
        <div className="upcoming-card">
          <h3 className="card-title">Upcoming</h3>
          <UpcomingCues cues={cues} beat={live?.beat} />
        </div>
      </div>
      <div className="master-bar">
        <MasterControls onAction={onMaster} />
      </div>
    </main>
  );
}
