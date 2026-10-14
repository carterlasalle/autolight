import { useRef, useState } from "react";
import { partyBeatEffects, partyEffectNames, type PartyEffectName } from "@autolight/ipc";
import { PARTY_PALETTES, useShell, typedInvoke, type PartyPalette } from "../../app/store.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Slider } from "../../components/ui/slider.js";
import type { DeviceTile } from "../venue/venue.js";

// The Live page's working light console (T-UI-04 follow-up): everything here
// commands the real rig through the typed venue channels. The show-scoped
// controls (style, energy, build/drop) stay disabled in the ControlGrid
// until the show runtime is built — no silent dead buttons.
//
// New renderer call sites use typedInvoke (callChannel under the hood):
// channel names and payloads are checked against the IPC table at compile
// time (the no-string-ipc ratchet).

// LED_PARTY's named preset colours: Red/Green/Blue/White open the list, then
// its Warm / ND Blue / Gold / Purple / Cyan / Amber. Shown until a track
// palette replaces them.
const BASIC_SWATCHES: { name: string; rgb: [number, number, number] }[] = [
  { name: "Red", rgb: [255, 0, 0] },
  { name: "Green", rgb: [0, 255, 0] },
  { name: "Blue", rgb: [0, 0, 255] },
  { name: "White", rgb: [255, 255, 255] },
  { name: "Warm", rgb: [255, 180, 120] },
  { name: "ND Blue", rgb: [12, 36, 150] },
  { name: "Gold", rgb: [255, 200, 0] },
  { name: "Purple", rgb: [170, 0, 255] },
  { name: "Cyan", rgb: [0, 255, 255] },
  { name: "Amber", rgb: [255, 120, 0] },
];

// Candidate band counts for the segment probe: the wizard's sweep values,
// offered as quick picks. The count is confirmed by eye on the unit.
const SEGMENT_CANDIDATES: readonly number[] = [8, 12, 14, 16, 20];

const EFFECT_LABELS: Record<PartyEffectName | "alternate", string> = {
  alternate: "Swap A/B", pulse: "Pulse", strobe: "Strobe", jump: "Jump", wash: "Wash", spot: "Spot",
  "beat-flash": "Beat: Flash", "beat-cycle": "Beat: Cycle", "beat-alternate": "Beat: A/B", "beat-rainbow": "Beat: Rainbow",
};

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

function fromHex(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());

  if (!match) return null;
  const n = Number.parseInt(match[1] ?? "", 16);

  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Display label for a light: the registry name, else its SKU. */
function lightLabel(t: DeviceTile): string {
  return t.name === t.id ? t.sku : t.name;
}

/** HSV → RGB (h in degrees, s/v in 0..1). The wheel's single conversion. */
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;
  const [r1, g1, b1] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x]
    : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];

  return [
    Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255),
  ];
}

/** Hue of an RGB colour in degrees (0 = red). */
function hueOf(rgb: [number, number, number]): number {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;

  return ((h * 60) % 360 + 360) % 360;
}

/** Hue ring with a draggable thumb; picks at full saturation. */
function ColorWheel({ colour, value, onPick }: {
  colour: [number, number, number];
  value: number;
  onPick: (rgb: [number, number, number], hue: number) => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const hue = hueOf(colour);
  const rad = ((hue - 90) * Math.PI) / 180;
  const thumbX = 50 + 42 * Math.cos(rad);
  const thumbY = 50 + 42 * Math.sin(rad);

  const pick = (clientX: number, clientY: number): void => {
    const el = ref.current;

    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    const h = (deg + 360) % 360;

    onPick(hsvToRgb(h, 1, value), h);
  };

  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Colour wheel"
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={Math.round(hue)}
      className="relative size-24 shrink-0 cursor-crosshair touch-none rounded-full"
      style={{ background: "conic-gradient(from 0deg, red, yellow, lime, cyan, blue, magenta, red)" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        pick(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => { if (dragging) pick(e.clientX, e.clientY); }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
    >
      <span className="absolute left-1/2 top-1/2 size-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border" style={{ background: toHex(colour) }} />
      <span
        className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
        style={{ left: `${thumbX}%`, top: `${thumbY}%`, background: toHex(colour) }}
      />
    </div>
  );
}

export function LightConsoleCard(): JSX.Element {
  const livePalette = useShell((st) => st.live?.palette ?? null);
  const tiles = useShell((st) => st.tiles);
  const colour = useShell((st) => st.wheelColor);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [wheelValue, setWheelValue] = useState(1);
  const [wheelHue, setWheelHue] = useState(() => hueOf(colour));

  const lights = tiles.filter((t) => t.enabled);

  const paint = (rgb: [number, number, number], target: string | null = targetId): void => {
    // An explicit pick takes the wheel: the alternate runner stops server
    // side, so its start/stop button must stop claiming it is running.
    useShell.getState().set({ wheelColor: rgb, altOn: false });
    void typedInvoke("venue/set-color", target === null ? { version: 1, rgb } : { version: 1, rgb, targets: [target] });
  };

  const blinder = (): void => {
    // Momentary white punch on the target, then back to the standing colour.
    const previous = colour;

    paint([255, 255, 255]);
    window.setTimeout(() => paint(previous), 140);
  };

  const swatches: { name: string; rgb: [number, number, number] }[] = [];
  const seen = new Set<string>();
  const source = livePalette !== null && livePalette.length > 0
    ? livePalette.map((rgb, i) => ({ name: `Track ${i + 1}`, rgb }))
    : BASIC_SWATCHES;

  for (const swatch of source) {
    const key = swatch.rgb.join(",");

    if (seen.has(key)) continue;
    seen.add(key);
    swatches.push(swatch);
  }

  return (
    <div className="min-w-0 rounded-xl border border-border bg-card px-4 py-3">
      <h3 className="text-base font-medium">Colour</h3>
      <div className="mt-2 flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Colour target">
          <Button size="sm" variant={targetId === null ? "default" : "outline"} onClick={() => setTargetId(null)} aria-pressed={targetId === null}>
            Both
          </Button>
          {lights.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant={targetId === t.id ? "default" : "outline"}
              onClick={() => setTargetId(t.id)}
              aria-pressed={targetId === t.id}
            >
              {lightLabel(t)}
            </Button>
          ))}
          {lights.length === 0 ? (
            <span className="text-xs text-muted-foreground">No lights on the rig — scan in Venue.</span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <ColorWheel
            colour={colour}
            value={wheelValue}
            onPick={(rgb, hue) => { setWheelHue(hue); paint(rgb); }}
          />
          <div className="flex min-w-0 flex-col gap-2">
            <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">Brightness
              <Slider
                aria-label="Wheel brightness"
                min={0.15} max={1} step={0.05} value={[wheelValue]}
                onValueChange={([v]) => {
                  const next = v ?? 1;

                  setWheelValue(next);
                  paint(hsvToRgb(wheelHue, 1, next));
                }}
              />
            </label>
            <div role="group" aria-label="Colour palette" className="flex flex-wrap items-center gap-2">
              {swatches.map((swatch, i) => (
                <button
                  key={`sw-${i}`} type="button" aria-label={swatch.name} title={swatch.name}
                  className="size-7 shrink-0 rounded-full border-2 border-white/20"
                  style={{ backgroundColor: `rgb(${swatch.rgb[0]},${swatch.rgb[1]},${swatch.rgb[2]})` }}
                  onClick={() => { setWheelHue(hueOf(swatch.rgb)); paint(swatch.rgb); }}
                />
              ))}
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Custom
                <input
                  type="color"
                  aria-label="Custom colour"
                  value={toHex(colour)}
                  onChange={(e) => {
                    const rgb = fromHex(e.target.value);

                    if (rgb) { setWheelHue(hueOf(rgb)); paint(rgb); }
                  }}
                  className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
                />
              </label>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={blinder}>Blinder</Button>
          <Button size="sm" variant="outline" onClick={() => { useShell.getState().set({ altOn: false }); void typedInvoke("master/blackout", { version: 1 }); }}>Blackout</Button>
          <Button
            size="sm" variant="outline"
            title="Power every enabled light back on after a switch-off, then re-arm the stream"
            onClick={() => { void typedInvoke("venue/power", { version: 1, on: true }); }}
          >
            Lights on
          </Button>
          <Button
            size="sm" variant="outline"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); useShell.getState().set({ altOn: false }); void typedInvoke("master/full", { version: 1 }); }}
            onPointerUp={() => { void typedInvoke("master/resume", { version: 1, at: "bar" }); }}
            onPointerCancel={() => { void typedInvoke("master/resume", { version: 1, at: "bar" }); }}
          >
            White (hold)
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Blinder and Blackout act on {targetId === null ? "both lights" : "the picked light"}; White (hold) is master-level (all lights). A fixture without a saved segment count cross-fades (count it in Segments to snap).</p>
      </div>
    </div>
  );
}

/** Party runner (manual lane): flashes between the two lamps, or between
 *  each strip's halves, at the chosen speed. Swap A/B alternates the two
 *  explicit colours; pulse, strobe, jump, wash and spot are LED_PARTY's
 *  effects re-created over the razer stream (palette-driven). */
export function AlternateCard(): JSX.Element {
  const altOn = useShell((st) => st.altOn);
  const altSpeed = useShell((st) => st.altSpeed);
  const wheelColour = useShell((st) => st.wheelColor);
  const [mode, setMode] = useState<"lamps" | "halves">("lamps");
  const [colourA, setColourA] = useState<[number, number, number]>(wheelColour);
  const [colourB, setColourB] = useState<[number, number, number]>([0, 0, 0]);
  const [effect, setEffect] = useState<PartyEffectName | "alternate">("alternate");
  const [palette, setPalette] = useState<PartyPalette>("ND");
  const tiles = useShell((st) => st.tiles);
  const halvesReady = tiles.filter((t) => t.enabled).every((t) => t.segments >= 2);
  const bIsInverse = colourB.every((v, i) => v === 255 - (colourA[i] ?? 0));
  const bIsOff = colourB.every((v) => v === 0);
  const bpm = useShell((st) => st.altBpm);
  const tapsRef = useRef<number[]>([]);
  const beatSelected = effect !== "alternate" && (partyBeatEffects as readonly string[]).includes(effect);
  // Palette-driven effects: pulse/strobe/jump read it, and so do the beat
  // cycle and downbeat rainbow; beat flash is white and alternate is A/B.
  const usesPalette = effect === "pulse" || effect === "strobe" || effect === "jump" || effect === "beat-cycle" || effect === "beat-rainbow";

  // Overrides let a running effect switch the moment the picker changes,
  // without waiting a render: the same reason the speed slider re-sends.
  // Tempo and speed default to the live store values, never a stale render.
  const send = (enabled: boolean, over: { effect?: PartyEffectName | "alternate"; palette?: PartyPalette; bpm?: number; speedMs?: number } = {}): void => {
    const fx = over.effect ?? effect;
    const pal = over.palette ?? palette;
    const tempo = over.bpm ?? useShell.getState().altBpm;
    const speed = over.speedMs ?? useShell.getState().altSpeed;
    const beat = fx !== "alternate" && (partyBeatEffects as readonly string[]).includes(fx);

    useShell.getState().set({ altOn: enabled });
    void typedInvoke("venue/alternate", {
      version: 1, enabled, mode, speedMs: speed, rgbA: colourA, rgbB: colourB,
      ...(fx !== "alternate" ? { effect: fx } : {}),
      ...(fx === "pulse" || fx === "strobe" || fx === "jump" || fx === "beat-cycle" || fx === "beat-rainbow" ? { palette: pal } : {}),
      ...(beat ? { bpm: tempo } : {}),
    }).then((res) => {
      if (res === null && enabled) useShell.getState().set({ altOn: false });
    });
  };

  // Tap tempo: median of the recent tap intervals, arithmetic only — the
  // beat feature never asks for the microphone.
  const tap = (): void => {
    const now = performance.now();
    const taps = [...tapsRef.current, now].filter((t) => now - t < 3000).slice(-6);

    tapsRef.current = taps;

    if (taps.length < 2) return;
    const intervals: number[] = [];

    for (let i = 1; i < taps.length; i++) {
      const prev = taps[i - 1];
      const cur = taps[i];

      if (prev !== undefined && cur !== undefined) intervals.push(cur - prev);
    }

    if (intervals.length === 0) return;
    intervals.sort((x, y) => x - y);
    const median = intervals[Math.floor(intervals.length / 2)];

    if (median === undefined || median <= 0) return;
    const next = Math.round(60_000 / median);

    if (next < 40 || next > 300) return;
    useShell.getState().set({ altBpm: next });
    if (altOn) send(true, { bpm: next });
  };

  return (
    <div className="min-w-0 rounded-xl border border-border bg-card px-4 py-3">
      <h3 className="text-base font-medium">Party</h3>
      <div className="mt-2 flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Alternate target">
          {(["lamps", "halves"] as const).map((m) => (
            <Button key={m} size="sm" variant={mode === m ? "default" : "outline"} disabled={m === "halves" && !halvesReady} onClick={() => setMode(m)} aria-pressed={mode === m}>
              {m === "lamps" ? "Two lamps" : "Strip halves"}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Party effect">
          {(["alternate", ...partyEffectNames] as const).map((e) => (
            <Button
              key={e} size="sm" variant={effect === e ? "default" : "outline"}
              onClick={() => {
                setEffect(e);
                // Beat hits need a fine tick: nudge a slow slider down once,
                // the same way the strobe preset sets 80ms.
                const beat = e !== "alternate" && (partyBeatEffects as readonly string[]).includes(e);
                const speed = beat && useShell.getState().altSpeed > 120 ? 50 : undefined;

                if (speed !== undefined) useShell.getState().set({ altSpeed: speed });
                if (altOn) send(true, { effect: e, ...(speed !== undefined ? { speedMs: speed } : {}) });
              }}
              aria-pressed={effect === e}
            >
              {EFFECT_LABELS[e]}
            </Button>
          ))}
        </div>
        {usesPalette ? (
          <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Party palette">
            {PARTY_PALETTES.map((p) => (
              <Button
                key={p} size="sm" variant={palette === p ? "default" : "outline"}
                onClick={() => { setPalette(p); if (altOn) send(true, { palette: p }); }}
                aria-pressed={palette === p}
              >
                {p}
              </Button>
            ))}
          </div>
        ) : null}
        {beatSelected ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">BPM
              <Input
                aria-label="Beat tempo"
                type="number" min={40} max={300}
                value={String(bpm)}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);

                  if (Number.isInteger(n) && n >= 40 && n <= 300) useShell.getState().set({ altBpm: n });
                }}
                onBlur={() => { if (altOn) send(true); }}
                className="h-8 w-20"
              />
            </label>
            <Button size="sm" variant="outline" onClick={tap}>Tap</Button>
            <span className="text-xs text-muted-foreground">Tap the tempo, or start the Audio sync card's mic to drive it — this card never requests the microphone.</span>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Colour A
            <input
              type="color"
              aria-label="Alternate colour A"
              value={toHex(colourA)}
              onChange={(e) => {
                const rgb = fromHex(e.target.value);

                if (!rgb) return;
                setColourA(rgb);
                // Presets follow the new A; a custom pair is left alone.
                if (bIsOff) setColourB([0, 0, 0]);
                else if (bIsInverse) setColourB([255 - rgb[0], 255 - rgb[1], 255 - rgb[2]]);
              }}
              className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Colour B
            <input
              type="color"
              aria-label="Alternate colour B"
              value={toHex(colourB)}
              onChange={(e) => {
                const rgb = fromHex(e.target.value);

                if (rgb) setColourB(rgb);
              }}
              className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Alternate B preset">
          <Button size="sm" variant={bIsOff ? "default" : "outline"} onClick={() => setColourB([0, 0, 0])} aria-pressed={bIsOff}>
            B = off
          </Button>
          <Button
            size="sm" variant={bIsInverse ? "default" : "outline"}
            onClick={() => setColourB([255 - colourA[0], 255 - colourA[1], 255 - colourA[2]])}
            aria-pressed={bIsInverse}
          >
            B = inverse of A
          </Button>
        </div>
        <label className="flex min-w-0 flex-col gap-1 text-sm">Speed: {altSpeed}ms
          <Slider min={40} max={2000} step={20} value={[altSpeed]} onValueChange={([v]) => {
            const next = v ?? 500;

            useShell.getState().set({ altSpeed: next });
            if (altOn) send(true);
          }} />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm" variant="secondary"
            onClick={() => {
              // Strobe = white <-> off at a fast flip rate over the razer
              // stream (the stream is what makes it snap; a lamp without a
              // saved count would smear instead). This is the plain A/B
              // swap, so the effect picker resets with it.
              setEffect("alternate");
              setColourA([255, 255, 255]);
              setColourB([0, 0, 0]);
              useShell.getState().set({ altSpeed: 80 });
              useShell.getState().set({ altOn: true });
              void typedInvoke("venue/alternate", { version: 1, enabled: true, mode, speedMs: 80, rgbA: [255, 255, 255], rgbB: [0, 0, 0] }).then((res) => {
                if (res === null) useShell.getState().set({ altOn: false });
              });
            }}
          >
            Strobe (white/off)
          </Button>
          {altOn
            ? <Button size="sm" variant="destructive" onClick={() => send(false)}>Stop party</Button>
            : <Button size="sm" onClick={() => send(true)}>Start party</Button>}
        </div>
        <p className="text-xs text-muted-foreground">
          Runs {mode === "lamps" ? "across the two lamps" : "across each strip's two halves"} at {altSpeed}ms: Swap A/B alternates colours A and B; pulse, strobe, jump, wash and spot are palette effects. The razer path makes both snap; a lamp without a saved segment count cross-fades instead.
        </p>
        {mode === "halves" && !halvesReady ? (
          <p className="text-xs text-muted-foreground">Strip halves need a saved segment count on every lamp (Segments card).</p>
        ) : null}
      </div>
    </div>
  );
}

export function SegmentsCard(): JSX.Element {
  const tiles = useShell((st) => st.tiles);
  const lights = tiles.filter((t) => t.enabled);
  const [lightId, setLightId] = useState<string | null>(null);
  const [count, setCount] = useState("");
  const [from, setFrom] = useState("0");
  const [to, setTo] = useState("1");
  const [rangeColour, setRangeColour] = useState<[number, number, number]>([255, 0, 0]);
  const light = lights.find((t) => t.id === (lightId ?? lights[0]?.id)) ?? null;
  const zonesText = light !== null && light.segments > 0 ? `${light.segments}` : "?";

  const zones = Number.parseInt(count, 10);
  const zonesValid = Number.isInteger(zones) && zones >= 1 && zones <= 255;
  const fromN = Math.max(0, Number.parseInt(from, 10) || 0);
  const toN = Math.max(0, Number.parseInt(to, 10) || 0);

  return (
    <div className="min-w-0 rounded-xl border border-border bg-card px-4 py-3">
      <h3 className="text-base font-medium">Segments</h3>
      <div className="mt-2 flex min-w-0 flex-col gap-2">
        {lights.length === 0 ? (
          <p className="text-xs text-muted-foreground">No lights on the rig — scan in Venue.</p>
        ) : (<>
          <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Segment light">
            {lights.map((t) => (
              <Button
                key={t.id}
                size="sm"
                variant={light !== null && light.id === t.id ? "default" : "outline"}
                onClick={() => setLightId(t.id)}
                aria-pressed={light !== null && light.id === t.id}
              >
                {lightLabel(t)}
              </Button>
            ))}
            <span className="ml-1 font-mono text-xs text-muted-foreground">{zonesText} segments counted</span>
          </div>
          <label className="flex min-w-0 items-center gap-2 text-sm">Count:
            <Input
              aria-label="Segment count"
              type="number" min={1} max={255} value={count}
              onChange={(e) => setCount(e.target.value)}
              placeholder="bands you see"
              className="h-8 w-24"
            />
            {SEGMENT_CANDIDATES.map((n) => (
              <Button key={n} size="sm" variant="ghost" onClick={() => setCount(String(n))}>{n}</Button>
            ))}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm" variant="outline" disabled={light === null || !zonesValid}
              onClick={() => {
                if (light === null || !zonesValid) return;
                void typedInvoke("venue/paint-stripes", { version: 1, id: light.id, zones });
              }}
            >
              Show stripes
            </Button>
            <Button
              size="sm" disabled={light === null || !zonesValid}
              onClick={() => {
                if (light === null || !zonesValid) return;
                void typedInvoke("venue/segments-set", { version: 1, id: light.id, zones });
              }}
            >
              Save count
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Paint stripes on the strip, count the bands with your eyes, then save that count: the segmented chase and segment paint use it.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">From
              <Input aria-label="Range first segment" type="number" min={0} max={254} value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-16" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">To
              <Input aria-label="Range last segment" type="number" min={0} max={254} value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-16" />
            </label>
            <input
              type="color"
              aria-label="Segment colour"
              value={toHex(rangeColour)}
              onChange={(e) => {
                const rgb = fromHex(e.target.value);

                if (rgb) setRangeColour(rgb);
              }}
              className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
            />
            <Button
              size="sm" variant="outline" disabled={light === null || light.segments <= 0}
              onClick={() => {
                if (light === null) return;
                void typedInvoke("venue/paint-range", { version: 1, id: light.id, from: fromN, to: toN, rgb: rangeColour });
              }}
            >
              Paint range
            </Button>
          </div>
          {light !== null && light.segments <= 0 ? (
            <p className="text-xs text-muted-foreground">Paint range needs a saved count first.</p>
          ) : null}
        </>)}
      </div>
    </div>
  );
}
