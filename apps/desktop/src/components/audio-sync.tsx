import { useEffect, useRef, useState } from "react";
import { createTempoTracker } from "@autolight/reactive-audio";
import { typedInvoke, useShell } from "../app/store.js";
import { Button } from "./ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.js";
import { MetricBadge, deckBpm } from "./kit.js";

// Audio sync: real mic overlay. Device select enumerates inputs, level meter
// proves signal, overlay nudges brightness/sparkle only (§69) — never
// strobe/palette/drop. "Not wired" copy is gone: this is wired.
export function AudioSyncCard(): JSX.Element {
  const s = useShell();
  const [level, setLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const startingRef = useRef(false);
  // deviceId per listed input, in the order the select shows: the stored index
  // is a position in that list, never a stable device identifier.
  const deviceIdsRef = useRef<string[]>([]);

  // One source for the input list: the renderer's own enumeration. The main
  // process reports no devices (listAudioDevices returns none by design), so a
  // second IPC-fed list would only fight this one over index semantics.
  const listDevices = async (): Promise<void> => {
    const { audioDevice, set } = useShell.getState();

    if (!navigator.mediaDevices) return;

    try {
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");

      deviceIdsRef.current = inputs.map((d) => d.deviceId);

      if (inputs.length === 0) return;
      set({ audioDevices: inputs.map((d, i) => ({ index: i, name: d.label || `Input ${i + 1}` })) });

      if (audioDevice === null) set({ audioDevice: 0 });
    } catch {
      set({ audioPermission: "denied" });
    }
  };

  // Stops the capture: the RAF loop, the mic tracks and the context it fed. A
  // context left open keeps counting against the page's audio-context budget.
  const releaseCapture = (): void => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const ctx = ctxRef.current;

    ctxRef.current = null;
    void ctx?.close();
  };

  useEffect(() => {
    void listDevices();
  }, []);

  useEffect(() => {
    return () => {
      releaseCapture();
    };
  }, []);

  const start = async (): Promise<void> => {
    // A second Start would orphan the live stream, its RAF loop and its
    // context: while a capture is live (or starting) this is a no-op.
    if (startingRef.current || streamRef.current !== null) return;
    startingRef.current = true;

    try {
      const selected = deviceIdsRef.current[s.audioDevice ?? -1] ?? "";

      // The chosen input, by id: without the constraint the browser opens the
      // system default and the select would claim a device it never opened.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selected === "" ? true : { deviceId: { exact: selected } },
      });

      streamRef.current = stream;
      s.set({ audioPermission: "granted" });
      const ctx = new AudioContext();

      ctxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const freq = new Uint8Array(analyser.frequencyBinCount);
      const prevFreq = new Uint8Array(analyser.frequencyBinCount);
      const tracker = createTempoTracker();
      let lastTempoMs = 0;

      const tick = (): void => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;

        for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
        setLevel(peak);
        // Sensitivity is live control state: read it at use time, not from the
        // render that started this loop.
        const sensitivity = useShell.getState().sensitivity;

        s.set({ audioLevel: peak, reactiveLevel: Math.min(1, peak * sensitivity) });

        // Onset tempo from spectral flux. This only runs because the operator
        // started this capture — no other code path ever opens the microphone.
        analyser.getByteFrequencyData(freq);
        let flux = 0;

        for (let i = 0; i < freq.length; i++) {
          const d = (freq[i] ?? 0) - (prevFreq[i] ?? 0);

          if (d > 0) flux += d;
        }

        prevFreq.set(freq);
        const now = performance.now();
        const bpm = tracker.push(flux, now);

        if (bpm !== null) {
          // Shared tempo state keeps the Party card's BPM box truthful while
          // the mic drives; the channel only nudges a runner that exists.
          if (useShell.getState().altBpm !== bpm) useShell.getState().set({ altBpm: bpm });

          if (useShell.getState().altOn && now - lastTempoMs > 1500) {
            lastTempoMs = now;
            void typedInvoke("venue/alternate-bpm", { version: 1, bpm });
          }
        }

        rafRef.current = requestAnimationFrame(tick);
      };

      tick();
      // The grant is what fills labels and real deviceIds in, so the list (and
      // with it the select) becomes meaningful only now; then show the input
      // that is actually capturing.
      await listDevices();
      const live = stream.getAudioTracks()[0]?.getSettings().deviceId ?? "";
      const index = deviceIdsRef.current.indexOf(live);

      if (index >= 0) s.set({ audioDevice: index });
    } catch (err) {
      // Only a refusal (or no input at all) is a permission verdict: a
      // constraint failure from an unplugged input must not claim the mic is
      // blocked.
      const refused = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "NotFoundError");

      if (refused || !(err instanceof DOMException)) s.set({ audioPermission: "denied" });
    } finally {
      startingRef.current = false;
    }
  };

  const stop = (): void => {
    releaseCapture();
    setLevel(0);
    s.set({ audioLevel: 0, reactiveLevel: 0 });
  };

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Audio sync</CardTitle></CardHeader>
      <CardContent>
        <MetricBadge metric={{ label: "BPM", value: deckBpm(s.bpm), unit: "" }} />
        <label className="flex items-center gap-2 text-sm">Input:
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
          <p className="text-sm text-muted-foreground">Mic blocked — enable microphone access, then Start.</p>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { void start(); }}>Start</Button>
          <Button size="sm" variant="outline" onClick={stop}>Stop</Button>
        </div>
        <p className="text-sm text-muted-foreground">Overlay nudges brightness/sparkle from the DJ grid (§69); the tempo detected here feeds the Party card's beat effects while this capture runs.</p>
      </CardContent>
    </Card>
  );
}
