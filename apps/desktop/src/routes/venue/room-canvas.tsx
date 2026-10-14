import type { Room } from "@autolight/venue";

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

export function RoomCanvas({ room }: { room: Room }): JSX.Element {
  const w = 320;
  const h = 320;
  const xs = room.outline.map((p) => p.x);
  const ys = room.outline.map((p) => p.y);
  // Framing widens the viewport to a 6 m minimum; the dimension readout must
  // report the room itself, so it uses the raw outline bounds.
  const roomW = Math.max(...xs) - Math.min(...xs);
  const roomH = Math.max(...ys) - Math.min(...ys);
  const minX = Math.min(...xs, -3);
  const maxX = Math.max(...xs, 3);
  const minY = Math.min(...ys, -3);
  const maxY = Math.max(...ys, 3);
  const sx = (x: number): number => ((x - minX) / Math.max(1e-6, maxX - minX)) * (w - 40) + 20;
  const sy = (y: number): number => h - (((y - minY) / Math.max(1e-6, maxY - minY)) * (h - 40) + 20);
  const pts = room.outline.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  // Anchors are unvalidated room data: render the DJ marker only when the
  // anchor actually exists instead of crashing the whole canvas.
  const dj: typeof room.anchors.dj | undefined = room.anchors?.dj;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Room outline: ${room.name}`} className="w-full rounded border">
      <polygon points={pts} fill="none" strokeWidth={2} stroke="currentColor" />
      {room.outline.map((p, i) => {
        // Wall labels sit at the wall's midpoint (wall i spans vertex i to
        // i+1), not at the shared corner, so the name labels its own wall.
        const next = room.outline[(i + 1) % room.outline.length] ?? p;
        const mx = (p.x + next.x) / 2;
        const my = (p.y + next.y) / 2;

        return (
          <g key={i}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={5} fill="currentColor" />
            <text x={sx(mx) + 7} y={sy(my) - 7} fontSize={10} fill="currentColor">
              {room.wallNames[i] ?? `W${i}`}
            </text>
          </g>
        );
      })}
      {dj ? (
        <g aria-label="DJ anchor">
          <circle cx={sx(dj.position.x)} cy={sy(dj.position.y)} r={7} fill="none" strokeWidth={2} stroke="currentColor" />
          {/* Engine facing convention (fields.ts rotate by -facing): the
              forward direction in room coordinates is (-sin f, cos f). */}
          <line
            x1={sx(dj.position.x)}
            y1={sy(dj.position.y)}
            x2={sx(dj.position.x - Math.sin(dj.facingRad) * 0.8)}
            y2={sy(dj.position.y + Math.cos(dj.facingRad) * 0.8)}
            strokeWidth={2}
            stroke="currentColor"
          />
        </g>
      ) : null}
      <circle cx={sx(0)} cy={sy(0)} r={3} fill="currentColor" opacity={0.4} aria-label="Center marker" />
      <text x={12} y={h - 8} fontSize={10} fill="currentColor">
        {fmt(roomW)} m by {fmt(roomH)} m, ceiling {fmt(room.ceilingHeight)} m
      </text>
    </svg>
  );
}

