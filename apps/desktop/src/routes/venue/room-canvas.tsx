import { useState } from "react";
import { rectangleRoom } from "@autolight/venue";
import type { Room } from "@autolight/venue";

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

export function RoomCanvas({ room, onPatch }: { room: Room; onPatch: (room: Room) => void }): JSX.Element {
  const w = 320;
  const h = 320;
  const xs = room.outline.map((p) => p.x);
  const ys = room.outline.map((p) => p.y);
  const minX = Math.min(...xs, -3);
  const maxX = Math.max(...xs, 3);
  const minY = Math.min(...ys, -3);
  const maxY = Math.max(...ys, 3);
  const sx = (x: number): number => ((x - minX) / Math.max(1e-6, maxX - minX)) * (w - 40) + 20;
  const sy = (y: number): number => h - (((y - minY) / Math.max(1e-6, maxY - minY)) * (h - 40) + 20);
  const pts = room.outline.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Room outline: ${room.name}`} className="w-full rounded border">
      <polygon points={pts} fill="none" strokeWidth={2} stroke="currentColor" />
      {room.outline.map((p, i) => (
        <g key={i}>
          <circle cx={sx(p.x)} cy={sy(p.y)} r={5} fill="currentColor" />
          <text x={sx(p.x) + 7} y={sy(p.y) - 7} fontSize={10}>
            {room.wallNames[i] ?? `W${i}`}
          </text>
        </g>
      ))}
      <g aria-label="DJ anchor">
        <circle cx={sx(room.anchors.dj.position.x)} cy={sy(room.anchors.dj.position.y)} r={7} fill="none" strokeWidth={2} stroke="currentColor" />
        <line
          x1={sx(room.anchors.dj.position.x)}
          y1={sy(room.anchors.dj.position.y)}
          x2={sx(room.anchors.dj.position.x + Math.sin(room.anchors.dj.facingRad) * 0.8)}
          y2={sy(room.anchors.dj.position.y + Math.cos(room.anchors.dj.facingRad) * 0.8)}
          strokeWidth={2}
          stroke="currentColor"
        />
      </g>
      <circle cx={sx(0)} cy={sy(0)} r={3} fill="currentColor" opacity={0.4} aria-label="Center marker" />
      <text x={12} y={h - 8} fontSize={10}>
        {fmt(maxX - minX)} m by {fmt(maxY - minY)} m, ceiling {fmt(room.ceilingHeight)} m
      </text>
      <g aria-hidden="true">
        <rect x={-100} y={-100} width={1} height={1} fill="none" onClick={() => onPatch(room)} />
      </g>
    </svg>
  );
}

export function useRoomState(initial?: Room): { room: Room; setRoom: (room: Room) => void; resetSquare: () => void } {
  const [room, setRoom] = useState<Room>(() => initial ?? rectangleRoom(5, 5));
  return { room, setRoom, resetSquare: () => setRoom(rectangleRoom(5, 5)) };
}
