import { useState } from "react";
import { useShell, invoke } from "../../app/store.js";
import type { FollowMode } from "../../app/store.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Button } from "../../components/ui/button.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.js";
import { SETUP_STEPS } from "../venue/venue.js";
import { RkbxSetupAssistant } from "./rkbx-setup-panel.js";
import { SIMULATOR_SCENARIOS, type SimulatorScenario } from "../../routes/settings/simulator-mode.js";
const MODES: { id: FollowMode; title: string; body: string }[] = [
  { id: "preview", title: "Preview", body: "Resolves the loaded track's ANLZ grid + plan, renders the venue preview. No playhead sync, no Govee output until a light is on the LAN." },
  { id: "ax-beat", title: "AX beat", body: "Polls Rekordbox's deck time fields at ~1Hz onto the ANLZ grid (±1 beat). Needs: Rekordbox AX readable. No board needed." },
  { id: "prolink", title: "PRO DJ LINK", body: "Virtual-CDJ beat/status capture. Beat-accurate with a link peer or CDJ; mixer-style status alone gives BPM only. Needs: link peer on the LAN." },
  { id: "soundswitch", title: "SoundSwitch", body: "Lighting IPC capture when Rekordbox 7.2.19+ + SoundSwitch 2.11+ lands. Blocked: not installed." },
];

// Setup (§100): step list + follow-mode setting, no modals.
export function SetupView(): JSX.Element {
  const mode = useShell((s) => s.followMode);
  const set = useShell((s) => s.set);
  const live = useShell((s) => s.live);
  const devices = useShell((s) => s.devices);
  const tiles = useShell((s) => s.tiles);
  const simulatorMode = useShell((s) => s.simulatorMode);
  const [scenario, setScenario] = useState<SimulatorScenario>("normal-night");
  // Steps resolve from measured state only: live show, scanned devices,
  // qualified tiles. No manual check-offs; unmet steps read pending.
  const done: string[] = [
    ...(live ? ["dj", "library", "analysis", "preview"] : ["dj"]),
    ...(devices.length > 0 ? ["lights"] : []),
    ...(tiles.length > 0 ? ["identify", "qualification"] : []),
  ];
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Follow mode</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div role="radiogroup" aria-label="Follow mode" className="grid grid-cols-2 gap-2">
            {MODES.map((m) => (
              <button
                key={m.id} type="button" role="radio" aria-checked={mode === m.id}
                onClick={() => { set({ followMode: m.id }); void invoke("follow/mode", { version: 1, mode: m.id }); }}
                className={`rounded-lg border p-2.5 text-left text-[13px] ${mode === m.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
              >
                <span className="font-medium">{m.title}</span>
              </button>
            ))}
          </div>
          <p className="text-[13px] text-muted-foreground">{MODES.find((m) => m.id === mode)?.body}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Simulator: {simulatorMode ? "on" : "off"}</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[13px]">Scenario:
            <Select value={scenario} onValueChange={(v) => setScenario(v as SimulatorScenario)}>
              <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{SIMULATOR_SCENARIOS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <Button size="sm" variant="outline" onClick={() => { set({ simulatorMode: !simulatorMode }); void invoke("simulator/mode", { version: 1, enabled: !simulatorMode, scenario }); }}>
            {simulatorMode ? "Exit simulator" : "Enter simulator"}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Setup: {done.length} of {SETUP_STEPS.length} ready</CardTitle></CardHeader>
        <CardContent>
          <ol aria-label="Setup" className="flex list-decimal flex-col gap-1.5 pl-5 text-[13px]">
            {SETUP_STEPS.map((s) => {
              const ready = done.includes(s);
              return (
                <li key={s} aria-current={!ready && done.length === SETUP_STEPS.indexOf(s) ? "step" : undefined}>
                  {ready ? "✓ " : ""}{s}
                  {!ready ? <span className="text-muted-foreground"> — pending</span> : null}
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
      <RkbxSetupAssistant />
    </div>
  );
}
