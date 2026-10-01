import { useShell, invoke } from "../../app/store.js";
import type { LiveState } from "../../app/store.js";
import { AudioSyncCard } from "../../components/audio-sync.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Slider } from "../../components/ui/slider.js";
import { Switch } from "../../components/ui/switch.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.js";
import { PARTY_PALETTES, ALT_PATTERNS } from "../../app/store.js";
import type { AltPattern, PartyPalette } from "../../app/store.js";
import { CueList, DeckPanel, FixturePreview, MasterControls, deckBpm } from "../../components/kit.js";
// Live screen (§89): status → decks + master clock → venue + upcoming →
// emergency bar. Empty until a real show resolves — never fixture tracks.
// Compact 32–36px controls, 12–14px text, mono for timing.
function masterIntent(intent: "blackout" | "full" | "freeze" | "resume"): void {
  if (intent === "blackout") void invoke("master/blackout", { version: 1 });
  else if (intent === "full") void invoke("master/full", { version: 1 });
  else if (intent === "freeze") void invoke("master/freeze", { version: 1, frozen: true });
  else void invoke("master/resume", { version: 1, at: "bar" });
}

function masterClock(bpm: number | null): string {
  const oneDecimal = deckBpm(bpm);
  return bpm === null ? "--.--" : `${oneDecimal}0`;
}

export function LiveView({ live }: { live: LiveState | null }): JSX.Element {
  const manual = useShell((s) => s.manual);
  if (!live) {
    return (
      <div className="flex flex-col gap-3">
        <Card>
          <CardHeader className="pb-1"><CardTitle>No show loaded</CardTitle></CardHeader>
          <CardContent>
            <p className="text-[13px] text-muted-foreground">
              Load a track on a Rekordbox deck. The show appears here once the
              library resolves the ANLZ grid and the planner compiles cues.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <MasterControls state={{ intensity: null, frozen: false, blackout: false, auto: !manual }} onIntent={masterIntent} />
          </CardContent>
        </Card>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[1fr_240px_1fr] gap-3">
        <DeckPanel
          deck={{
            title: live.deckA.title,
            subtitle: "Deck 1",
            bpm: live.bpm,
            section: live.deckA.section ?? null,
            countdown: live.deckA.countdown ?? null,
            health: "neutral",
          }}
        />
        <Card className="text-center">
          <CardContent className="flex flex-col justify-center pt-4">
            <p role="timer" className="font-timing text-5xl font-semibold tabular-nums">{masterClock(live.bpm)}</p>
            <span className="text-xs tracking-widest text-muted-foreground">BPM</span>
          </CardContent>
        </Card>
        <DeckPanel
          deck={{
            title: live.deckB.title,
            subtitle: "Deck 2",
            bpm: live.bpm,
            section: live.deckB.section ?? null,
            countdown: live.deckB.countdown ?? null,
            health: "neutral",
          }}
        />
      </div>
      <div className="grid grid-cols-[2fr_1fr] gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-[13px]">Live venue preview</CardTitle></CardHeader>
          <CardContent>
            {live.cells.length > 0 ? (
              <FixturePreview rows={[{ cells: live.cells }]} />
            ) : (
              <p className="text-[13px] text-muted-foreground">No fixture output — qualify a light on the Venue tab.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-[13px]">Upcoming</CardTitle></CardHeader>
          <CardContent>
            {live.cues.length > 0 ? (
              <CueList
                cues={live.cues.slice(0, 5).map((c) => ({ cue: c, now: live.beat ?? 0 }))}
                now={live.beat ?? 0}
              />
            ) : (
              <p className="text-[13px] text-muted-foreground">No cues — plan compiles after analysis.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardContent className="pt-4">
          <MasterControls state={{ intensity: null, frozen: false, blackout: false, auto: !manual }} onIntent={masterIntent} />
        </CardContent>
      </Card>
    </div>
  );
}

// Below-fold manual lane (§88): every led_party intent, shadcn controls.
export function ControlGrid(): JSX.Element {
  const s = useShell();
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Autoloops show</CardTitle></CardHeader>
        <CardContent>
          <label className="flex items-center gap-2 text-[13px]">Style:
            <Select value={s.style} onValueChange={(v) => {
              s.set({ style: v });
              void invoke("show/style", { version: 1, style: v === "House" ? "house" : v === "EDM" ? "festival" : v === "Hip-Hop" ? "club" : "lounge", palette: s.palette });
            }}>
              <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{["House", "EDM", "Hip-Hop", "Chill"].map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="flex items-center gap-2 text-[13px]">Palette:
            <Select value={s.palette} onValueChange={(v) => { s.set({ palette: v as PartyPalette }); }}>
              <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{PARTY_PALETTES.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <Switch checked={s.blinder} onCheckedChange={(v) => { s.set({ blinder: v }); }} /> Blinder on phrase (8 bars)
          </label>
          {!s.running
            ? <Button size="sm" onClick={() => { s.set({ running: true }); void invoke("master/resume", { version: 1, at: "bar" }); }}>Start live autoloops</Button>
            : <Button size="sm" variant="outline" onClick={() => { s.set({ running: false }); void invoke("master/freeze", { version: 1, frozen: true }); }}>Stop live autoloops</Button>}
        </CardContent>
      </Card>
      <AudioSyncCard />
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Color + brightness</CardTitle></CardHeader>
        <CardContent>
          <div role="group" aria-label="Swatches" className="flex flex-wrap gap-2">
            {[
              ["Red", [255, 0, 0]], ["Green", [0, 255, 0]], ["Blue", [0, 0, 255]],
              ["White", [255, 255, 255]], ["Warm", [255, 180, 120]],
              ["ND Blue", [12, 36, 150]], ["Gold", [255, 200, 0]],
              ["Purple", [170, 0, 255]], ["Cyan", [0, 255, 255]], ["Amber", [255, 120, 0]],
            ].map(([name, rgb]) => (
              <button
                key={name as string} type="button" aria-label={name as string} title={name as string}
                className="size-7 rounded-full border-2 border-white/20"
                style={{ backgroundColor: `rgb(${(rgb as number[])[0]},${(rgb as number[])[1]},${(rgb as number[])[2]})` }}
                onClick={() => {
                  s.set({ wheelColor: rgb as [number, number, number] });
                  void invoke("venue/set-color", { version: 1, rgb });
                }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { void invoke("master/blackout", { version: 1 }); }}>Blackout</Button>
            <Button
              size="sm" variant="outline"
              onMouseDown={() => { void invoke("master/full", { version: 1 }); }}
              onMouseUp={() => { void invoke("master/resume", { version: 1, at: "bar" }); }}
            >
              White (hold)
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Flash on beat</CardTitle></CardHeader>
        <CardContent>
          <label className="flex items-center gap-2 text-[13px]">
            <Switch checked={s.flashOn} onCheckedChange={(v) => { s.set({ flashOn: v }); }} /> Flash on beat
          </label>
          <div className="flex gap-3 text-[13px]">
            {(["static", "cycle"] as const).map((m) => (
              <label key={m} className="flex items-center gap-1.5">
                <input type="radio" name="flash-mode" checked={s.flashMode === m} onChange={() => { s.set({ flashMode: m }); }} />
                {m === "static" ? "Static" : "Cycle"}
              </label>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Manual control</CardTitle></CardHeader>
        <CardContent>
          <label className="flex items-center gap-2 text-[13px]">
            <Switch checked={s.manual} onCheckedChange={(v) => { s.set({ manual: v }); }} /> Manual override
          </label>
          <div className="flex gap-2" role="group" aria-label="Manual Energy Tier">
            {(["LOW", "MED", "HIGH"] as const).map((t) => (
              <Button key={t} size="sm" variant="outline" disabled={!s.manual} onClick={() => {
                s.set({ tier: t });
                void invoke("show/energy", { version: 1, tier: t });
              }}>{t}</Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { void invoke("show/trigger-build", { version: 1 }); }}>Build</Button>
            <Button size="sm" variant="outline" onClick={() => { void invoke("show/trigger-drop", { version: 1 }); }}>Drop</Button>
          </div>
          <label className="flex flex-col gap-1 text-[13px]">Sensitivity: {s.sensitivity.toFixed(1)}x
            <Slider min={0.5} max={2} step={0.1} value={[s.sensitivity]} onValueChange={([v]) => { s.set({ sensitivity: v ?? 1 }); }} />
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Alternating A/B</CardTitle></CardHeader>
        <CardContent>
          <label className="flex items-center gap-2 text-[13px]">
            <Switch checked={s.altOn} onCheckedChange={(v) => { s.set({ altOn: v }); }} /> Alternating mode
          </label>
          <label className="flex items-center gap-2 text-[13px]">Pattern:
            <Select value={s.altPattern} onValueChange={(v) => { s.set({ altPattern: v as AltPattern }); }}>
              <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{ALT_PATTERNS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-[13px]">Speed: {s.altSpeed}ms
            <Slider min={100} max={2000} step={50} value={[s.altSpeed]} onValueChange={([v]) => { s.set({ altSpeed: v ?? 500 }); }} />
          </label>
        </CardContent>
      </Card>
    </div>
  );
}
