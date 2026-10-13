import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button.js";
import { Switch } from "../../components/ui/switch.js";
import { Slider } from "../../components/ui/slider.js";
import { InspectorPanel } from "../../components/kit.js";
import type { TrackModel } from "@autolight/contracts";
import { useShell, invoke } from "../../app/store.js";
import { addDropBeat, auditionAtBeat, type CorrectionOp } from "../../routes/inspector/inspector-helpers.js";

// state, never refetched per tick. Beat audition renders that beat in the
// preview; nothing reaches the lights unless send-to-lights is on. Blend A/B
// viewer and corrections ops sit below the lanes.
export function InspectorView(): JSX.Element {
  const selected = useShell((s) => s.selectedTrackId);
  const live = useShell((s) => s.live);
  const [track, setTrack] = useState<TrackModel | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sendToLights, setSendToLights] = useState(false);
  const [audition, setAudition] = useState<string | null>(null);
  const [blend, setBlend] = useState(0.5);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = (await invoke("show/live", { version: 1 })) as unknown as {
          decks: { state: { deckId: number }; track: TrackModel | null }[];
        } | null;

        const decks = raw && Array.isArray(raw.decks) ? raw.decks : [];

        for (const d of decks) {
          if (!d.track) continue;
          const title = d.track.identity.title ?? d.track.identity.id;

          if (selected && title !== selected && live && title !== live.deckA.title && title !== live.deckB.title) continue;

          if (!cancelled) { setLoaded(true); setTrack(d.track);

 return; }
        }

        if (!cancelled) { setLoaded(true); setTrack(null); }
      } catch { /* show host unreachable: empty lanes below */ }

      if (!cancelled) { setLoaded(true); setTrack(null); }
    })();

    return () => { cancelled = true; };
  }, [selected, live]);

  const lanes = (beat: number): void => {
    if (!track) return;
    const pick = auditionAtBeat(track, [], beat, sendToLights);
    setAudition(pick ? `beat ${pick.beat}: ${pick.cueType}${sendToLights ? " to lights" : " in preview"}` : null);
  };

  const correct = (op: CorrectionOp): void => {
    void invoke("show/correction", { version: 1, op, sendToLights: false });
    setAudition(`correction queued: ${op.op}`);
  };

  return (
    <section className="flex max-w-5xl flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3">
      <h2 className="min-w-0 truncate text-base font-medium" title={selected ? `Track inspector — ${selected}` : "Track inspector"}>Track inspector{selected ? ` — ${selected}` : ""}</h2>
      {!loaded ? (
        <p className="text-sm text-muted-foreground">Loading lanes…</p>
      ) : track === null ? (
        <InspectorEmpty onSetup={() => { useShell.getState().set({ route: "setup" }); }} />
      ) : (
        <InspectorBody track={track} lanes={lanes} correct={correct} sendToLights={sendToLights} setSendToLights={setSendToLights} blend={blend} setBlend={setBlend} audition={audition} />
      )}
    </section>
  );
}

export function InspectorEmpty({ onSetup }: { onSetup: () => void }): JSX.Element {
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-sm text-muted-foreground">No track analyzed yet. Lanes for waveform, grid, sections, events, and cues appear after the analysis worker finishes a loaded deck.</p>
      <Button size="sm" variant="outline" onClick={onSetup}>Open Setup</Button>
    </div>
  );
}

function InspectorBody({ track, lanes, correct, sendToLights, setSendToLights, blend, setBlend, audition }: {
  track: TrackModel;
  lanes: (beat: number) => void;
  correct: (op: CorrectionOp) => void;
  sendToLights: boolean;
  setSendToLights: (v: boolean) => void;
  blend: number;
  setBlend: (v: number) => void;
  audition: string | null;
}): JSX.Element {
  const eventBeats = track.musicalEvents.map((e) => e.beat);

  const finiteMax = (values: number[], floor: number): number =>
    values.reduce((m, v) => (Number.isFinite(v) ? Math.max(m, v) : m), floor);

  const lastBeat = finiteMax([...track.sections.map((s) => s.endBeat), ...eventBeats], 1);
  const firstDrop = track.musicalEvents.find((e) => e.type === "drop")?.beat;
  const dropBeat = firstDrop ?? Math.min(lastBeat, finiteMax(eventBeats, 0));
  const auditionBeat = Math.min(lastBeat, dropBeat + 1);
  const addBeat = addDropBeat(track.musicalEvents, lastBeat);
  const section = track.sections.find((s) => dropBeat >= s.startBeat && dropBeat < s.endBeat);
  const sectionStart = section?.startBeat ?? Math.max(0, dropBeat - 32);
  const sectionEnd = section?.endBeat ?? lastBeat;

  return (
    <>
      <InspectorPanel track={track} startBeat={0} endBeat={lastBeat} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="min-w-0 tabular-nums" onClick={() => lanes(auditionBeat)}>Audition beat {auditionBeat}</Button>
        <label className="flex min-w-0 items-center gap-2 text-sm">
          <Switch checked={sendToLights} onCheckedChange={setSendToLights} /> Send to lights
        </label>
        <label className="flex min-w-0 items-center gap-2 text-sm">Blend A/B:
          <Slider min={0} max={1} step={0.1} value={[blend]} onValueChange={(v) => setBlend(v[0] ?? blend)} aria-label="Blend A/B" className="w-32" />
          <span className="tabular-nums">{blend.toFixed(1)}</span>
        </label>
      </div>
      {audition ? <p className="min-w-0 text-sm text-muted-foreground">{audition}</p> : null}
      <div className="flex flex-col gap-2" role="group" aria-label="Corrections">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Drop corrections">
          {addBeat === null ? (
            <span className="text-sm text-muted-foreground">No drop-free beat available</span>
          ) : (
            <Button size="sm" variant="outline" onClick={() => correct({ op: "add-drop", beat: addBeat })}>Add missing drop at {addBeat}</Button>
          )}
          <Button size="sm" variant="outline" onClick={() => correct({ op: "delete-drop", beat: dropBeat })}>Delete false drop at {dropBeat}</Button>
          <Button size="sm" variant="outline" onClick={() => correct({ op: "mark-fake-drop", beat: dropBeat, actualBeat: Math.min(lastBeat, dropBeat + 32) })}>Mark fake drop {dropBeat} to {Math.min(lastBeat, dropBeat + 32)}</Button>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Section corrections">
          <Button size="sm" variant="outline" onClick={() => correct({ op: "regenerate-section", startBeat: sectionStart, endBeat: sectionEnd })}>Regenerate section {sectionStart} to {sectionEnd}</Button>
          <Button size="sm" variant="outline" onClick={() => correct({ op: "lock-section", startBeat: sectionStart, endBeat: sectionEnd })}>Lock section {sectionStart} to {sectionEnd}</Button>
        </div>
      </div>
    </>
  );
}
