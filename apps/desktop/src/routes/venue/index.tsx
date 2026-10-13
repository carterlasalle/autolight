import { useState } from "react";
import type { Room } from "@autolight/venue";
import { polygonCentroid, rectangleRoom } from "@autolight/venue";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { RoomCanvas } from "./room-canvas.js";
import { MappingWizard } from "./mapping-wizard.js";

function roomWidth(room: Room): number {
  const xs = room.outline.map((p) => p.x);

  return Math.max(1, Math.max(...xs) - Math.min(...xs));
}

function roomDepth(room: Room): number {
  const ys = room.outline.map((p) => p.y);

  return Math.max(1, Math.max(...ys) - Math.min(...ys));
}

// Width edit rescales the existing outline about its own center, so ceiling,
// anchors, walls, and openings survive the change (S4: no factory rebuild).
function pointInPolygon(p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false;

  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;

    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }

  return inside;
}

export function rescaleOutline(room: Room, widthM: number, depthM: number): Room {
  const targetW = Number.isFinite(widthM) && widthM > 0 ? widthM : roomWidth(room);
  const targetD = Number.isFinite(depthM) && depthM > 0 ? depthM : roomDepth(room);
  const xs = room.outline.map((p) => p.x);
  const ys = room.outline.map((p) => p.y);
  const spanX = Math.max(1e-6, Math.max(...xs) - Math.min(...xs));
  const spanY = Math.max(1e-6, Math.max(...ys) - Math.min(...ys));
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const sx = targetW / spanX;
  const sy = targetD / spanY;

  const shift = (p: { x: number; y: number }) => ({
    x: cx + (p.x - cx) * sx,
    y: cy + (p.y - cy) * sy,
  });

  const outline = room.outline.map(shift);
  const centroid = polygonCentroid(outline);
  // The scaled DJ anchor can sit inside the bounding box yet outside a
  // non-rectangular outline, so test against the polygon itself and walk back
  // toward the centroid until the anchor is inside the room.
  const shiftedDj = shift(room.anchors.dj.position);
  let djPosition = shiftedDj;

  if (!pointInPolygon(shiftedDj, outline)) {
    djPosition = centroid;

    for (let t = 0; t <= 1; t += 0.1) {
      const candidate = { x: shiftedDj.x + (centroid.x - shiftedDj.x) * t, y: shiftedDj.y + (centroid.y - shiftedDj.y) * t };

      if (pointInPolygon(candidate, outline)) {
        djPosition = candidate;
        break;
      }
    }
  }

  return {
    ...room,
    outline,
    anchors: {
      ...room.anchors,
      dj: { ...room.anchors.dj, position: djPosition },
      center: room.anchors.center === null ? null : shift(room.anchors.center),
      audience: room.anchors.audience === null ? null : shift(room.anchors.audience),
      custom: room.anchors.custom.map((a) => ({ ...a, position: { ...a.position, ...shift(a.position) } })),
    },
  };
}

export function RoomVenueRoute({ room: roomProp, onRoom, saved: savedProp, onSaved }: {
  room?: Room; onRoom?: (room: Room) => void; saved?: boolean; onSaved?: (saved: boolean) => void;
} = {}): JSX.Element {
  const [localRoom, setLocalRoom] = useState<Room>(() => roomProp ?? rectangleRoom(5, 5));
  const [localSaved, setLocalSaved] = useState(savedProp ?? false);
  const [widthText, setWidthText] = useState<string | null>(null);
  // Controlled-ness follows the room prop: a caller supplying roomProp owns the
  // state (edits go through onRoom); otherwise edits update local state and
  // still notify onRoom when it is provided, so no half-wired pair can freeze.
  const room = roomProp ?? localRoom;
  const setRoom = (next: Room): void => {
    if (roomProp !== undefined) onRoom?.(next);
    else {
      setLocalRoom(next);
      onRoom?.(next);
    }
  };
  const saved = savedProp ?? localSaved;
  const setSaved = (value: boolean): void => {
    if (savedProp !== undefined) onSaved?.(value);
    else {
      setLocalSaved(value);
      onSaved?.(value);
    }
  };
  const commitWidth = (text: string): void => {
    const value = Number(text);

    if (Number.isFinite(value)) setRoom(rescaleOutline(room, Math.min(30, Math.max(1, value)), roomDepth(room)));
    setWidthText(null);
  };

  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <section aria-label="Room editor" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Room editor</h2>
        <RoomCanvas room={room} onPatch={setRoom} />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            Width (m)
            <Input
              type="number"
              value={widthText ?? roomWidth(room)}
              min={1}
              max={30}
              step={0.1}
              aria-label="Room width meters"
              onChange={(e) => setWidthText(e.target.value)}
              onBlur={(e) => commitWidth(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitWidth(e.currentTarget.value);
              }}
              className="h-8 w-20"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            Ceiling (m)
            <Input
              type="number"
              value={room.ceilingHeight}
              min={2}
              max={6}
              step={0.1}
              aria-label="Ceiling height meters"
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setRoom({ ...room, ceilingHeight: Math.min(6, Math.max(2, v)) });
              }}
              className="h-8 w-20"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            DJ facing (deg)
            <Input
              type="number"
              value={Math.round((room.anchors.dj.facingRad * 180) / Math.PI)}
              step={5}
              aria-label="DJ facing degrees"
              onChange={(e) => setRoom({
                ...room,
                anchors: { ...room.anchors, dj: { ...room.anchors.dj, facingRad: ((Number(e.target.value) || 0) * Math.PI) / 180 } },
              })}
              className="h-8 w-20"
            />
          </label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setSaved(true);
            }}
          >
            Save room
          </Button>
          {saved ? <span className="text-sm">Saved in memory; venue persistence exports the file.</span> : null}
        </div>
      </section>
      <MappingWizard onDone={() => setSaved(true)} />
      <p className="text-sm text-muted-foreground">Live preview: {roomWidth(room).toFixed(1)} m by {roomDepth(room).toFixed(1)} m, ceiling {room.ceilingHeight.toFixed(1)} m, DJ at ({room.anchors.dj.position.x.toFixed(2)}, {room.anchors.dj.position.y.toFixed(2)}).</p>
    </div>
  );
}
