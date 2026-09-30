import { useEffect, useRef, useState } from "react";
import { useShell, invoke } from "../state/store.js";
import { Button } from "./ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.js";

// Audio sync: real mic overlay. Device select enumerates inputs, level meter
// proves signal, overlay nudges brightness/sparkle only (§69) — never
// strobe/palette/drop. "Not wired" copy is gone: this is wired.
export function AudioSyncCard(): JSX.Element {
  const s = useShell();
  const [level, setLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    void invoke("audio/devices", { version: 1 }).then((raw: unknown) => {
      const envelope = raw as { ok?: boolean; devices?: { index: number; name: string }[] } | null;
      const list = envelope && envelope.ok !== false && Array.isArray(envelope.devices) ? envelope.devices : [];
      if (list.length > 0) s.set({ audioDevices: list });
    });
    return () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void navigator.mediaDevices?.enumerateDevices().then((devs) => {
      const inputs = devs
        .filter((d) => d.kind === "audioinput")
        .map((d, i) => ({ index: i, name: d.label || `Input ${i + 1}` }));
      if (inputs.length > 0) {
        s.set({ audioDevices: inputs, audioPermission: "granted" });
        if (s.audioDevice === null) s.set({ audioDevice: inputs[0]?.index ?? 0 });
      }
    }).catch(() => { s.set({ audioPermission: "denied" }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      s.set({ audioPermission: "granted" });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = (): void => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
        setLevel(peak);
        s.set({ audioLevel: peak, reactiveLevel: Math.min(1, peak * s.sensitivity) });
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      s.set({ audioPermission: "denied" });
    }
  };

  const stop = (): void => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLevel(0);
    s.set({ audioLevel: 0, reactiveLevel: 0 });
  };

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-[13px]">Audio sync</CardTitle></CardHeader>
      <CardContent>
        <p className="font-timing text-[13px] tabular-nums">BPM: {s.bpm !== null ? s.bpm.toFixed(1) : "--"}</p>
        <label className="flex items-center gap-2 text-[13px]">Input:
          <Select
            value={s.audioDevice !== null ? String(s.audioDevice) : ""}
            onValueChange={(v) => { s.set({ audioDevice: Number(v) }); }}
          >
            <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Select input" /></SelectTrigger>
            <SelectContent>
              {s.audioDevices.map((d) => <SelectItem key={d.index} value={String(d.index)}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded bg-muted" role="meter" aria-valuenow={Math.round(level * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Input level">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
          <span className="font-timing text-xs tabular-nums">{Math.round(level * 100)}%</span>
        </div>
        {s.audioPermission === "denied" && (
          <p className="text-[13px] text-muted-foreground">Mic blocked — enable microphone access, then Start.</p>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { void start(); }}>Start</Button>
          <Button size="sm" variant="outline" onClick={stop}>Stop</Button>
        </div>
        <p className="text-[13px] text-muted-foreground">Overlay nudges brightness/sparkle from the DJ grid (§69) — never mic guessing.</p>
      </CardContent>
    </Card>
  );
}
