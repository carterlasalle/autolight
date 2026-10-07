import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Button } from "../../components/ui/button.js";
import { Switch } from "../../components/ui/switch.js";
import { Input } from "../../components/ui/input.js";
import { Slider } from "../../components/ui/slider.js";
import { InspectorPanel } from "../../components/kit.js";
import type { TrackModel } from "@autolight/contracts";
import { useShell, invoke } from "../../app/store.js";
import { auditionAtBeat, inspectorDefaults, type CorrectionOp } from "../../routes/inspector/inspector-helpers.js";
// Inspector (spec 96): synchronized lanes bound once per track and cached in
// state, never refetched per tick. Beat audition renders that beat in the
// preview; nothing reaches the lights unless send-to-lights is on. Blend A/B
// viewer and corrections ops sit below the lanes. The beat and correction
// targets come from the installed track, not hard-coded fixture beats.
export function InspectorView(): JSX.Element {
  const selected = useShell((s) => s.selectedTrackId);
  const live = useShell((s) => s.live);
  const [track, setTrack] = useState<TrackModel | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sendToLights, setSendToLights] = useState(false);
  const [audition, setAudition] = useState<string | null>(null);
  const [blend, setBlend] = useState(0.5);
  const [beat, setBeat] = useState<number | null>(null);
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
          if (!cancelled) { setLoaded(true); setTrack(d.track); return; }
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
  const defaults = inspectorDefaults(track);
  const activeBeat = beat ?? defaults.beat;
  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Track inspector{selected ? `: ${selected}` : ""}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          {!loaded ? (
            <p className="text-sm text-muted-foreground">Loading lanes…</p>
          ) : track === null ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">No track analyzed yet. Lanes for waveform, grid, sections, events, and cues appear after the analysis worker finishes a loaded deck.</p>
              <div>
                <Button size="sm" onClick={() => { useShell.getState().set({ route: "setup" }); }}>Open Setup</Button>
              </div>
            </div>
          ) : (
            <>
              <InspectorPanel
                track={track}
                startBeat={0}
                endBeat={Math.max(1, ...track.sections.map((s) => s.endBeat), ...track.musicalEvents.map((e) => e.beat))}
              />
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-sm">Beat:
                  <Input
                    type="number"
                    min={0}
                    value={activeBeat}
                    aria-label="Audition beat"
                    className="w-24"
                    onChange={(e) => setBeat(Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
                <Button size="sm" variant="outline" onClick={() => lanes(activeBeat)}>Audition beat {activeBeat}</Button>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={sendToLights} onCheckedChange={setSendToLights} /> Send to lights
                </label>
                <label className="flex flex-1 items-center gap-2 text-sm">Blend A/B:
                  <Slider
                    min={0} max={1} step={0.1} value={[blend]} aria-label="Blend A/B"
                    className="max-w-40"
                    onValueChange={([v]) => setBlend(v ?? 0.5)}
                  />
                  {blend.toFixed(1)}
                </label>
              </div>
              {audition ? <p className="text-sm text-muted-foreground">{audition}</p> : null}
              <div className="flex flex-col gap-2" role="group" aria-label="Corrections">
                <div className="flex flex-wrap gap-2" role="group" aria-label="Drop corrections">
                  <Button size="sm" variant="outline" onClick={() => correct({ op: "add-drop", beat: activeBeat })}>Add drop at {activeBeat}</Button>
                  <Button size="sm" variant="outline" onClick={() => correct({ op: "delete-drop", beat: activeBeat })}>Delete false drop at {activeBeat}</Button>
                  <Button size="sm" variant="outline" onClick={() => correct({ op: "mark-fake-drop", beat: defaults.dropBeat, actualBeat: defaults.nextBeat })}>
                    Mark drop {defaults.dropBeat} as {defaults.nextBeat}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Section corrections">
                  <Button size="sm" variant="outline" onClick={() => correct({ op: "regenerate-section", startBeat: defaults.sectionStart, endBeat: defaults.sectionEnd })}>Regenerate section {defaults.sectionStart} to {defaults.sectionEnd}</Button>
                  <Button size="sm" variant="outline" onClick={() => correct({ op: "lock-section", startBeat: defaults.sectionStart, endBeat: defaults.sectionEnd })}>Lock section {defaults.sectionStart} to {defaults.sectionEnd}</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
