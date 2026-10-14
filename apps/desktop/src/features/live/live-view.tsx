import { useShallow } from "zustand/shallow";
import { useShell, typedInvoke } from "../../app/store.js";
import type { LiveState } from "../../app/store.js";
import { Button } from "../../components/ui/button.js";
import { Slider } from "../../components/ui/slider.js";
import { Switch } from "../../components/ui/switch.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.js";
import { BUILT_IN_STYLES } from "@autolight/show-planner";
import { ALT_PATTERNS } from "../../app/store.js";
import type { AltPattern } from "../../app/store.js";
import { nextPhraseBeat } from "../../routes/live/live-fields.js";
import { LightConsoleCard, SegmentsCard } from "./light-console.js";
import { CueList, DeckPanel, FixturePreview, MasterControls } from "../../components/kit.js";
import { AudioSyncCard } from "../../components/audio-sync.js";

// Live, redesigned: the beat leads (big mono clock between the decks), the
// room preview plus upcoming cues sit side by side, the emergency bar pins to
// the section bottom so it never scrolls away mid-set. Every prior control
// survives: decks, style/palette, autoloops, palette swatches, blackout/white
// hold, flash, manual tiers, build/drop, target, sensitivity, alternating.
// Every intent also mirrors into the shell store, so MasterControls labels and
// aria-pressed reflect the active blackout/freeze instead of hardcoded values.
function masterIntent(intent: "blackout" | "full" | "freeze" | "resume"): void {
  const sync = useShell.getState().set;

  if (intent === "blackout") {
    sync({ blackout: true, frozen: false });
    void typedInvoke("master/blackout", { version: 1 });
  } else if (intent === "full") {
    sync({ blackout: false });
    void typedInvoke("master/full", { version: 1 });
  } else if (intent === "freeze") {
    sync({ frozen: true });
    void typedInvoke("master/freeze", { version: 1, frozen: true });
  } else {
    sync({ blackout: false, frozen: false });
    void typedInvoke("master/resume", { version: 1, at: "bar" });
  }
}

function MasterBar({ sticky }: { sticky: boolean }): JSX.Element {
  const intensity = useShell((s) => s.overridesIntensity);
  const manual = useShell((s) => s.manual);
  const frozen = useShell((s) => s.frozen);
  const blackout = useShell((s) => s.blackout);

  return (
    <section aria-label="Master" className={`rounded-xl border border-border bg-card px-4 py-3${sticky ? " md:sticky md:bottom-3" : ""}`}>
      <MasterControls state={{ intensity, frozen, blackout, auto: !manual }} onIntent={masterIntent} />
    </section>
  );
}

function masterClock(bpm: number | null): string {
  return bpm === null ? "--.--" : bpm.toFixed(1);
}

export function LiveView({ live }: { live: LiveState | null }): JSX.Element {
  const set = useShell((s) => s.set);

  if (!live) {
    return (
      <div className="flex max-w-5xl flex-col gap-4">
        <section aria-label="No show" className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
          <p className="font-mono text-4xl font-semibold tabular-nums text-muted-foreground">--.--</p>
          <h2 className="mt-2 text-base font-medium">No show loaded</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Load a track on a Rekordbox deck. The beat clock, room preview, and cues appear here once the show resolves.
          </p>
          <Button size="sm" className="mt-3" onClick={() => { set({ route: "setup" }); }}>Open Setup</Button>
        </section>
        <MasterBar sticky={false} />
      </div>
    );
  }

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <section aria-label="Decks and clock" className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
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
        <div aria-label="Master clock" className="flex min-w-0 flex-row items-baseline justify-center gap-2 rounded-xl border border-border bg-card px-6 py-3 text-center md:flex-col md:justify-center">
          <p role="timer" className="font-mono text-5xl font-semibold tabular-nums">{masterClock(live.bpm)}</p>
          <span className="text-xs tracking-widest text-muted-foreground">BPM</span>
        </div>
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
      </section>
      <section aria-label="Room and cues" className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]">
        <div className="min-w-0 rounded-xl border border-border bg-card px-4 py-3">
          <h2 className="text-base font-medium">Room</h2>
          <div className="mt-2">
            {live.cells.length > 0 ? (
              <FixturePreview rows={[{ cells: live.cells }]} />
            ) : (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 basis-48 text-sm text-muted-foreground">No fixture output. Qualify a light first.</p>
                <Button size="sm" variant="outline" onClick={() => { set({ route: "venue" }); }}>Open Venue</Button>
              </div>
            )}
          </div>
        </div>
        <div className="min-w-0 rounded-xl border border-border bg-card px-4 py-3">
          <h2 className="text-base font-medium">Up next</h2>
          <div className="mt-2">
            {live.cues.length > 0 ? (
              <CueList
                cues={live.cues.slice(0, 5).map((c) => ({ cue: c, now: live.beat ?? 0 }))}
                now={live.beat ?? 0}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No cues yet. They compile after analysis.</p>
            )}
          </div>
        </div>
      </section>
      <MasterBar sticky={true} />
    </div>
  );
}

// Below-fold manual lane: the working light console plus the show-scoped
// controls, grouped by purpose with one heading each. Controls whose effect
// needs the show runtime (style, energy, build/drop, flash, alternate) are
// disabled with that stated — a button that records an intent nobody
// consumes is a dead button.
function isAltPattern(v: string): v is AltPattern {
  return ALT_PATTERNS.some((p) => p === v);
}

const RUNTIME_NOTE = "Needs the show runtime (not built yet): acts when a show is loaded.";

export function ControlGrid(): JSX.Element {
  const s = useShell(useShallow((st) => ({
    style: st.style, palette: st.palette, pendingStyle: st.pendingStyle, blinder: st.blinder,
    running: st.running, flashOn: st.flashOn, flashMode: st.flashMode,
    manual: st.manual, tier: st.tier, liveBeat: st.liveBeat, target: st.target,
    sensitivity: st.sensitivity, altOn: st.altOn, altPattern: st.altPattern, altSpeed: st.altSpeed,
    set: st.set,
  })));

  return (
    <section aria-label="Manual control" className="mt-4">
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Manual</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
      <div className="min-w-0 rounded-xl border border-border bg-card px-4 py-3">
        <h3 className="text-base font-medium">Style</h3>
        <div className="mt-2 flex min-w-0 flex-col gap-2">
          <label className="flex min-w-0 items-center gap-2 text-sm">Style:
            <Select disabled value={s.style} onValueChange={(v) => {
              s.set({ style: v, pendingStyle: v });
              void typedInvoke("show/style", { version: 1, style: v, palette: s.palette, custom: false });
            }}>
              <SelectTrigger className="h-8 min-w-0 flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.keys(BUILT_IN_STYLES).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          {s.pendingStyle !== null ? (
            <p className="text-xs text-muted-foreground">Pending {s.pendingStyle}: applies at the next phrase boundary.</p>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <Switch disabled checked={s.blinder} onCheckedChange={(v) => { s.set({ blinder: v }); }} /> Blinder on next phrase
          </label>
          <Button size="sm" disabled variant="outline">Live autoloops</Button>
          <p className="text-xs text-muted-foreground">{RUNTIME_NOTE}</p>
        </div>
      </div>
      <AudioSyncCard />
      <LightConsoleCard />
      <SegmentsCard />
      <div className="min-w-0 rounded-xl border border-border bg-card px-4 py-3">
        <h3 className="text-base font-medium">Flash</h3>
        <div className="mt-2 flex min-w-0 flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch disabled checked={s.flashOn} onCheckedChange={(v) => { s.set({ flashOn: v }); }} /> Flash on beat
          </label>
          <div className="flex gap-3 text-sm">
            {(["static", "cycle"] as const).map((m) => (
              <label key={m} className="flex items-center gap-1.5">
                <input type="radio" name="flash-mode" disabled checked={s.flashMode === m} onChange={() => { s.set({ flashMode: m }); }} />
                {m === "static" ? "Static" : "Cycle"}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{RUNTIME_NOTE}</p>
        </div>
      </div>
      <div className="min-w-0 rounded-xl border border-border bg-card px-4 py-3">
        <h3 className="text-base font-medium">Takeover</h3>
        <div className="mt-2 flex min-w-0 flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch disabled checked={s.manual} onCheckedChange={(v) => { s.set({ manual: v }); }} /> Manual override
          </label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Manual Energy Tier">
            {(["LOW", "MED", "HIGH"] as const).map((t) => (
              <Button key={t} size="sm" variant={s.tier === t ? "default" : "outline"} disabled onClick={() => {
                s.set({ tier: t });
                void typedInvoke("show/energy", { version: 1, tier: t });
              }}>{t}</Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled onClick={() => { void typedInvoke("show/trigger-build", { version: 1, at: nextPhraseBeat(s.liveBeat) }); }}>Build</Button>
            <Button size="sm" variant="outline" disabled onClick={() => { void typedInvoke("show/trigger-drop", { version: 1 }); }}>Drop</Button>
          </div>
          <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Spatial target">
            {(["A", "B", "Both"] as const).map((t) => (
              <label key={t} className="flex items-center gap-1.5 text-sm">
                <input type="radio" name="spatial-target" disabled checked={s.target === t} onChange={() => { s.set({ target: t }); }} />
                {t}
              </label>
            ))}
          </div>
          <label className="flex min-w-0 flex-col gap-1 text-sm">Master intensity: {s.sensitivity.toFixed(1)}x
            <Slider min={0.5} max={1} step={0.05} value={[s.sensitivity]} onValueChange={([v]) => {
              const next = v ?? 1;
              s.set({ sensitivity: next });
              void typedInvoke("master/intensity", { version: 1, value: next });
            }} />
          </label>
          <p className="text-xs text-muted-foreground">{RUNTIME_NOTE}</p>
        </div>
      </div>
      <div className="min-w-0 rounded-xl border border-border bg-card px-4 py-3">
        <h3 className="text-base font-medium">Alternate</h3>
        <div className="mt-2 flex min-w-0 flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch disabled checked={s.altOn} onCheckedChange={(v) => { s.set({ altOn: v }); void typedInvoke("show/energy", { version: 1, tier: s.tier ?? "MED", alternate: v }); }} /> Alternating mode
          </label>
          <label className="flex min-w-0 items-center gap-2 text-sm">Pattern:
            <Select disabled value={s.altPattern} onValueChange={(v) => { if (!isAltPattern(v)) return; s.set({ altPattern: v }); void typedInvoke("show/energy", { version: 1, tier: s.tier ?? "MED", alternate: s.altOn, pattern: v }); }}>
              <SelectTrigger className="h-8 min-w-0 flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>{ALT_PATTERNS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-sm">Speed: {s.altSpeed}ms
            <Slider disabled min={100} max={2000} step={50} value={[s.altSpeed]} onValueChange={([v]) => {
              const next = v ?? 500;
              s.set({ altSpeed: next });
              void typedInvoke("show/energy", { version: 1, tier: s.tier ?? "MED", alternate: s.altOn, speedMs: next });
            }} />
          </label>
          <p className="text-xs text-muted-foreground">{RUNTIME_NOTE}</p>
        </div>
      </div>
      </div>
    </section>
  );
}
