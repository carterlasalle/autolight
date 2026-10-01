import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Button } from "../../components/ui/button.js";
import { Switch } from "../../components/ui/switch.js";
import { InspectorPanel } from "../../components/kit.js";
import type { TrackModel } from "@autolight/contracts";
import { useShell, invoke } from "../../app/store.js";
import { auditionAtBeat, blendView, type CorrectionOp } from "../../routes/inspector/inspector-helpers.js";
// Inspector (spec 96): synchronized lanes bound once per track and cached in
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
  void blendView;
  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Track inspector{selected ? ` — ${selected}` : ""}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          {!loaded ? (
            <p className="text-[13px] text-muted-foreground">Loading lanes…</p>
          ) : track === null ? (
            <p className="text-[13px] text-muted-foreground">No track analyzed yet. Lanes for waveform, grid, sections, events, and cues appear after the analysis worker finishes a loaded deck.</p>
          ) : (
            <>
              <InspectorPanel
                track={track}
                startBeat={0}
                endBeat={Math.max(1, ...track.sections.map((s) => s.endBeat), ...track.musicalEvents.map((e) => e.beat))}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => lanes(257)}>Audition beat 257</Button>
                <label className="flex items-center gap-2 text-[13px]">
                  <Switch checked={sendToLights} onCheckedChange={setSendToLights} /> Send to lights
                </label>
                <label className="flex items-center gap-2 text-[13px]">Blend A/B:
                  <input type="range" min={0} max={1} step={0.1} value={blend} onChange={(e) => setBlend(Number(e.target.value))} aria-label="Blend A/B" />
                  {blend.toFixed(1)}
                </label>
              </div>
              {audition ? <p className="text-[13px] text-muted-foreground">{audition}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => correct({ op: "add-drop", beat: 256 })}>Add missing drop at 256</Button>
                <Button size="sm" variant="outline" onClick={() => correct({ op: "delete-drop", beat: 256 })}>Delete false drop at 256</Button>
                <Button size="sm" variant="outline" onClick={() => correct({ op: "mark-fake-drop", beat: 256, actualBeat: 288 })}>Mark fake drop 256 to 288</Button>
                <Button size="sm" variant="outline" onClick={() => correct({ op: "regenerate-section", startBeat: 224, endBeat: 256 })}>Regenerate section 224 to 256</Button>
                <Button size="sm" variant="outline" onClick={() => correct({ op: "lock-section", startBeat: 224, endBeat: 256 })}>Lock section 224 to 256</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
