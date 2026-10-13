import { useState } from "react";
import { useShell, invoke } from "../../app/store.js";
import type { FollowMode } from "../../app/store.js";
import { Button } from "../../components/ui/button.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.js";
import { SETUP_EVIDENCE_STEPS, setupEvidence, setupProgress, type EvidenceStep } from "../../routes/setup/setup-model.js";
import { RkbxSetupAssistant } from "./rkbx-setup-panel.js";
import { SIMULATOR_SCENARIOS, type SimulatorScenario } from "../../routes/settings/simulator-mode.js";

export const STEP_LABELS: Record<EvidenceStep, { title: string; hint: string; route: "setup" | "library" | "venue" | "inspector" | "live" }> = {
  dj: { title: "DJ link", hint: "Rekordbox or Serato deck state flowing", route: "live" },
  controller: { title: "Controller", hint: "No controller evidence over IPC yet — stays pending", route: "setup" },
  library: { title: "Library", hint: "At least one track resolved", route: "library" },
  lights: { title: "Lights", hint: "Govee scan found a device on the LAN", route: "venue" },
  identify: { title: "Identify", hint: "IDENTIFY flashed a real fixture", route: "venue" },
  placement: { title: "Placement", hint: "Room editor has no saved-room record yet — stays pending", route: "venue" },
  orientation: { title: "Orientation", hint: "DJ anchor facing has no saved-room record yet — stays pending", route: "venue" },
  qualification: { title: "Qualification", hint: "TEST CHASE passed on every tile", route: "venue" },
  analysis: { title: "Analysis", hint: "ANLZ grid plus sections resolved", route: "inspector" },
  preview: { title: "Preview", hint: "Venue preview rendered a show frame", route: "live" },
};

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

  // Follow-mode restore lives in Shell on route-enter (covers HMR/reset);
  // this view only writes via the mode buttons below.
  const evidence = setupEvidence({
    live, devices, tiles,
    identifiedIds: useShell((s) => s.identifiedIds),
    chasePassedIds: useShell((s) => s.chasePassedIds),
    roomSaved: useShell((s) => s.roomSaved),
  });

  const { done, next } = setupProgress(evidence);
  const nextMeta = next === "ready" ? null : STEP_LABELS[next];

  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <section className="rounded-xl border border-border bg-card px-4 py-3">
        <h2 className="text-base font-medium">Follow mode</h2>
        <div role="radiogroup" aria-label="Follow mode" className="mt-2 grid grid-cols-2 gap-2">
          {MODES.map((m) => (
            <button
              key={m.id} type="button" role="radio" aria-checked={mode === m.id}
              onClick={() => { set({ followMode: m.id }); void invoke("follow/mode", { version: 1, mode: m.id }); }}
              className={`min-w-0 rounded-lg border p-2.5 text-left text-sm ${mode === m.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
            >
              <span className="block truncate font-medium" title={m.title}>{m.title}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 min-w-0 text-sm text-muted-foreground">{MODES.find((m) => m.id === mode)?.body}</p>
      </section>
      <section className="rounded-xl border border-border bg-card px-4 py-3">
        <h2 className="text-base font-medium">Simulator: {simulatorMode ? "on" : "off"}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex min-w-0 items-center gap-2 text-sm">Scenario:
            <Select value={scenario} onValueChange={(v) => setScenario(v as SimulatorScenario)}>
              <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{SIMULATOR_SCENARIOS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <Button size="sm" variant="outline" onClick={() => { set({ simulatorMode: !simulatorMode }); void invoke("simulator/mode", { version: 1, enabled: !simulatorMode, scenario }); }}>
            {simulatorMode ? "Exit simulator" : "Enter simulator"}
          </Button>
        </div>
      </section>
      <section className="rounded-xl border border-border bg-card px-4 py-3">
        <h2 className="text-base font-medium">Setup: {done.length} of {SETUP_EVIDENCE_STEPS.length} ready</h2>
        <p className="mt-0.5 min-w-0 truncate text-sm text-muted-foreground" title={nextMeta ? `Next: ${nextMeta.title}` : "All steps ready"}>
          {nextMeta ? `Next: ${nextMeta.title}` : "All steps ready"}
        </p>
        <ol aria-label="Setup" className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-sm">
          {SETUP_EVIDENCE_STEPS.map((s) => {
            // Total by construction: STEP_LABELS covers every EvidenceStep.
            const meta: (typeof STEP_LABELS)[EvidenceStep] = STEP_LABELS[s];
            const ready = done.includes(s);
            const isNext = next === s;

            return (
              <li key={s} aria-current={isNext ? "step" : undefined} className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate" title={`${meta.title} — ${ready ? "ready" : meta.hint}`}>{ready ? "✓ " : ""}{meta.title}<span className="text-muted-foreground"> — {ready ? "ready" : meta.hint}</span></span>
                {!ready && meta.route !== "setup" ? <Button size="sm" variant="outline" onClick={() => { set({ route: meta.route }); }}>Open {meta.title}</Button> : null}
              </li>
            );
          })}
        </ol>
      </section>
      <RkbxSetupAssistant />
    </div>
  );
}
