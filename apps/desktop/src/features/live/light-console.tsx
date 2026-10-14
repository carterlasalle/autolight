import { useState } from "react";
import { useShell, typedInvoke } from "../../app/store.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import type { DeviceTile } from "../venue/venue.js";

// The Live page's working light console (T-UI-04 follow-up): everything here
// commands the real rig through the typed venue channels. The show-scoped
// controls (style, energy, build/drop) stay disabled in the ControlGrid
// until the show runtime is built — no silent dead buttons.
//
// New renderer call sites use typedInvoke (callChannel under the hood):
// channel names and payloads are checked against the IPC table at compile
// time (the no-string-ipc ratchet).

const BASIC_SWATCHES: [number, number, number][] = [
  [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255],
];

// Candidate band counts for the segment probe: the wizard's sweep values,
// offered as quick picks. The count is confirmed by eye on the unit.
const SEGMENT_CANDIDATES: readonly number[] = [8, 12, 14, 16, 20];

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
export function lightLabel(t: DeviceTile): string {
  return t.name === t.id ? t.sku : t.name;
}

export function LightConsoleCard(): JSX.Element {
  const livePalette = useShell((st) => st.live?.palette ?? null);
  const tiles = useShell((st) => st.tiles);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [colour, setColour] = useState<[number, number, number]>([255, 255, 255]);

  const lights = tiles.filter((t) => t.enabled);

  const paint = (rgb: [number, number, number], target: string | null = targetId): void => {
    setColour(rgb);
    void typedInvoke("venue/set-color", target === null ? { version: 1, rgb } : { version: 1, rgb, targets: [target] });
  };

  const blinder = (): void => {
    // Momentary white punch on the target, then back to the standing colour.
    const previous = colour;

    paint([255, 255, 255]);
    window.setTimeout(() => paint(previous), 140);
  };

  const swatches: [number, number, number][] = [];
  const seen = new Set<string>();

  for (const rgb of livePalette !== null && livePalette.length > 0 ? livePalette : BASIC_SWATCHES) {
    const key = rgb.join(",");

    if (seen.has(key)) continue;
    seen.add(key);
    swatches.push(rgb);
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
        <div role="group" aria-label="Colour palette" className="flex flex-wrap items-center gap-2">
          {swatches.map((rgb, i) => (
            <button
              key={`sw-${i}`} type="button" aria-label={`colour ${i + 1}`}
              className="size-7 shrink-0 rounded-full border-2 border-white/20"
              style={{ backgroundColor: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` }}
              onClick={() => paint(rgb)}
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

                if (rgb) paint(rgb);
              }}
              className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={blinder}>Blinder</Button>
          <Button size="sm" variant="outline" onClick={() => { void typedInvoke("master/blackout", { version: 1 }); }}>Blackout</Button>
          <Button
            size="sm" variant="outline"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); void typedInvoke("master/full", { version: 1 }); }}
            onPointerUp={() => { void typedInvoke("master/resume", { version: 1, at: "bar" }); }}
            onPointerCancel={() => { void typedInvoke("master/resume", { version: 1, at: "bar" }); }}
          >
            White (hold)
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Blinder and Blackout act on {targetId === null ? "both lights" : "the picked light"}; White (hold) is master-level (all lights).</p>
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
