import { useShell } from "../state/store.js";
import type { FollowMode } from "../state/store.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { SETUP_STEPS } from "../venue.js";

const MODES: { id: FollowMode; title: string; body: string }[] = [
  { id: "preview", title: "Preview (designer tool)", body: "Resolves the loaded track's ANLZ grid + plan, renders the venue preview. No playhead sync, no Govee output until a light is on the LAN. Works with your Macro setup untouched." },
  { id: "ax-beat", title: "AX beat (coarse follow)", body: "Polls Rekordbox's deck time fields at ~1Hz and maps elapsed time onto the ANLZ grid (±1 beat). Needs: Rekordbox AX readable. No board needed." },
  { id: "prolink", title: "PRO DJ LINK (beat-accurate)", body: "Virtual-CDJ beat/status capture per Deep Symmetry's analysis (MIT beat-link-trigger lineage, EPL beat-link core). Beat-accurate; Rekordbox in Performance mode sends mixer-style status (BPM of master, no playhead) — full position needs a link peer or CDJ. Needs: link peer on the LAN." },
  { id: "soundswitch", title: "SoundSwitch IPC (future)", body: "Lighting IPC capture when Rekordbox 7.2.19+ + SoundSwitch 2.11+ lands. Sample-accurate transport. Blocked: not installed." },
];

// Setup (§100): step list + follow-mode setting, no modals.
export function SetupView(): JSX.Element {
  const mode = useShell((s) => s.followMode);
  const set = useShell((s) => s.set);
  const done: string[] = ["dj", "controller"];
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Follow mode</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div role="radiogroup" aria-label="Follow mode" className="flex flex-col gap-2">
            {MODES.map((m) => (
              <label key={m.id} className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-[13px]">
                <input type="radio" name="follow-mode" checked={mode === m.id} onChange={() => { set({ followMode: m.id }); }} className="mt-1" />
                <span><strong>{m.title}.</strong> {m.body}</span>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Setup</CardTitle></CardHeader>
        <CardContent>
          <ol aria-label="Setup" className="flex list-decimal flex-col gap-1.5 pl-5 text-[13px]">
            {SETUP_STEPS.map((s) => (
              <li key={s} aria-current={done.length === SETUP_STEPS.indexOf(s) ? "step" : undefined}>
                {done.includes(s) ? "✓ " : ""}{s}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
