import { useState } from "react";
import { useShell, invoke } from "../../app/store.js";
import type { FollowMode } from "../../app/store.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Button } from "../../components/ui/button.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.js";
import { SETUP_STEPS } from "../venue/venue.js";
import { RkbxSetupAssistant } from "./rkbx-setup-panel.js";
import { setupProgress, type EvidenceStep } from "../../routes/setup/setup-model.js";
import { SIMULATOR_SCENARIOS, type SimulatorScenario } from "../../routes/settings/simulator-mode.js";
const MODES: { id: FollowMode; title: string; body: string }[] = [
  { id: "preview", title: "Preview (designer tool)", body: "Resolves the loaded track's ANLZ grid + plan, renders the venue preview. No playhead sync, no Govee output until a light is on the LAN. Works with your Macro setup untouched." },
  { id: "ax-beat", title: "AX beat (coarse follow)", body: "Polls Rekordbox's deck time fields at ~1Hz and maps elapsed time onto the ANLZ grid (±1 beat). Needs: Rekordbox AX readable. No board needed." },
  { id: "prolink", title: "PRO DJ LINK (beat-accurate)", body: "Virtual-CDJ beat/status capture per Deep Symmetry's analysis (MIT beat-link-trigger lineage, EPL beat-link core). Beat-accurate; Rekordbox in Performance mode sends mixer-style status (BPM of master, no playhead) — full position needs a link peer or CDJ. Needs: link peer on the LAN." },
  { id: "soundswitch", title: "SoundSwitch IPC (pending capture)", body: "Lighting IPC capture when Rekordbox 7.2.19+ + SoundSwitch 2.11+ lands. Sample-accurate transport. Blocked: not installed." },
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
  const [evidence, setEvidence] = useState<Partial<Record<EvidenceStep, boolean>>>({});
  const progress = setupProgress(evidence);
  void progress;
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
          <div role="radiogroup" aria-label="Follow mode" className="flex flex-col gap-2">
            {MODES.map((m) => (
              <label key={m.id} className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-[13px]">
                <input type="radio" name="follow-mode" checked={mode === m.id} onChange={() => { set({ followMode: m.id }); void invoke("follow/mode", { version: 1, mode: m.id }); }} className="mt-1" />
                <span><strong>{m.title}.</strong> {m.body}</span>
              </label>
            ))}
          </div>
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
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Setup: {progress.done.length} of 10 with evidence</CardTitle></CardHeader>
        <CardContent>
          <ol aria-label="Setup" className="flex list-decimal flex-col gap-1.5 pl-5 text-[13px]">
            {SETUP_STEPS.map((s) => (
              <li key={s} aria-current={done.length === SETUP_STEPS.indexOf(s) ? "step" : undefined}>
                {done.includes(s) || evidence[s as EvidenceStep] ? "✓ " : ""}{s}
                {!done.includes(s) && !evidence[s as EvidenceStep] ? <Button size="sm" variant="outline" onClick={() => setEvidence((prev) => ({ ...prev, [s as EvidenceStep]: true }))}>Check</Button> : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <RkbxSetupAssistant />
    </div>
  );
}
