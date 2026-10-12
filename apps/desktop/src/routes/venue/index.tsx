import { useState } from "react";
import type { Room } from "@autolight/venue";
import { rectangleRoom } from "@autolight/venue";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { RoomCanvas } from "./room-canvas.js";
import { MappingWizard } from "./mapping-wizard.js";
import { RoomPreview } from "./room-preview.js";

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
function rescaleOutline(room: Room, widthM: number, depthM: number): Room {
  const xs = room.outline.map((p) => p.x);
  const ys = room.outline.map((p) => p.y);
  const spanX = Math.max(1e-6, Math.max(...xs) - Math.min(...xs));
  const spanY = Math.max(1e-6, Math.max(...ys) - Math.min(...ys));
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const sx = widthM / spanX;
  const sy = depthM / spanY;
  const shift = (p: { x: number; y: number }): { x: number; y: number } => ({
    x: cx + (p.x - cx) * sx,
    y: cy + (p.y - cy) * sy,
  });
  const dj = room.anchors.dj.position;
  const shiftedDj = shift(dj);
  const djInside = Math.abs(shiftedDj.x - cx) <= widthM / 2 && Math.abs(shiftedDj.y - cy) <= depthM / 2;
  return {
    ...room,
    outline: room.outline.map(shift),
    anchors: {
      ...room.anchors,
      dj: { ...room.anchors.dj, position: djInside ? shiftedDj : { x: cx, y: cy - depthM / 2 + Math.min(0.5, depthM / 2) } },
    },
  };
}

export function RoomVenueRoute({ room: roomProp, onRoom, saved: savedProp, onSaved }: {
  room?: Room; onRoom?: (room: Room) => void; saved?: boolean; onSaved?: (saved: boolean) => void;
} = {}): JSX.Element {
  const [localRoom, setLocalRoom] = useState<Room>(() => roomProp ?? rectangleRoom(5, 5));
  const [localSaved, setLocalSaved] = useState(savedProp ?? false);
  const room = roomProp ?? localRoom;
  const setRoom = onRoom ?? setLocalRoom;
  const saved = savedProp ?? localSaved;
  const setSaved = onSaved ?? setLocalSaved;
  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <section aria-label="Room editor" className="flex flex-col gap-2">
        <h2 className="text-[13px] font-semibold">Room editor</h2>
        <RoomCanvas room={room} onPatch={setRoom} />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[13px]">
            Width (m)
            <Input
              type="number"
              value={roomWidth(room)}
              min={1}
              max={30}
              step={0.1}
              aria-label="Room width meters"
              onChange={(e) => {
                const w = Math.min(30, Math.max(1, Number(e.target.value) || 5));
                setRoom(rescaleOutline(room, w, roomDepth(room)));
              }}
              className="h-8 w-20"
            />
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            Ceiling (m)
            <Input
              type="number"
              value={room.ceilingHeight}
              min={2}
              max={6}
              step={0.1}
              aria-label="Ceiling height meters"
              onChange={(e) => setRoom({ ...room, ceilingHeight: Number(e.target.value) || room.ceilingHeight })}
              className="h-8 w-20"
            />
          </label>
          <label className="flex items-center gap-2 text-[13px]">
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
          {saved ? <span className="text-[13px]">Saved in memory; venue persistence exports the file.</span> : null}
        </div>
      </section>
      <MappingWizard onDone={() => setSaved(true)} />
      <RoomPreview roomId="square-loop" />
    </div>
  );
}
