import { StatusDot, DeckPanel, MasterControls } from "./components.js";
export function App(): JSX.Element {
  return (
    <main>
      <StatusDot ok label="REKORDBOX" />
      <DeckPanel deck={1} title="Deck A" />
      <DeckPanel deck={2} title="Deck B" />
      <MasterControls />
    </main>
  );
}
