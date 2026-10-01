import { useMemo, useState } from "react";
import { computeFields, referenceById, fieldCellsForReference } from "@autolight/venue";
import { sampleSpatial } from "@autolight/renderer";
function cellColor(level: number): string {
  const v = Math.round(Math.min(1, Math.max(0, level)) * 255);
  return `rgb(${v},${Math.round(v * 0.6)},${Math.round(v * 0.2)})`;
}

export function RoomPreview({ roomId = "square-loop" }: { roomId?: string }): JSX.Element {
  const [beat, setBeat] = useState(1);
  const cells = useMemo(() => {
    const ref = referenceById(roomId);
    const room = { ...ref.room, logicalZeroS: ref.zeroS, perimeterDirection: "clockwise" as const };
    const built = fieldCellsForReference(ref);
    const fields = computeFields(room, built.cells, ref.runs, { zeroS: ref.zeroS });
    const params = { heads: 1, direction: "clockwise" as const, beatsPerRevolution: 4, tailCells: 3, tailCurve: "exp" as const, phase: 0, includeProjected: false };
    return built.cells.map((_, i) => {
      const sample = sampleSpatial("Orbit", params, beat, i, fields);
      return { x: built.cells[i]!.pos.x, y: built.cells[i]!.pos.y, level: sample.level };
    });
  }, [roomId, beat]);
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const minX = Math.min(...xs, -3);
  const maxX = Math.max(...xs, 3);
  const minY = Math.min(...ys, -3);
  const maxY = Math.max(...ys, 3);
  const w = 320;
  const h = 240;
  const sx = (x: number): number => ((x - minX) / Math.max(1e-6, maxX - minX)) * (w - 20) + 10;
  const sy = (y: number): number => h - (((y - minY) / Math.max(1e-6, maxY - minY)) * (h - 20) + 10);
  return (
    <section aria-label="Real room preview" className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Room preview with live cells" className="w-full rounded border">
        {cells.map((c, i) => (
          <circle key={i} cx={sx(c.x)} cy={sy(c.y)} r={5} fill={cellColor(c.level)} />
        ))}
      </svg>
      <label className="text-[13px]">
        Beat
        <input
          type="number"
          value={beat}
          min={0}
          max={16}
          step={0.25}
          aria-label="Preview beat"
          onChange={(e) => setBeat(Number(e.target.value) || 0)}
          className="ml-2 w-20 rounded border px-1"
        />
      </label>
    </section>
  );
}
