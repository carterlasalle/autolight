import { useState } from "react";
import type { Room } from "@autolight/venue";
import { rectangleRoom } from "@autolight/venue";
import { RoomCanvas } from "./room-canvas.js";
import { MappingWizard } from "./mapping-wizard.js";
import { RoomPreview } from "./room-preview.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs.js";
import { Input } from "../../components/ui/input.js";
import { VenueView } from "../../features/venue/venue-view.js";

// Venue screen: the Lights tab (scan + device tiles) and the room editor. The
// room editor was unreachable before this composition, so strip mapping had no
// entry point in the UI.
export function VenueScreen(): JSX.Element {
  return (
    <Tabs defaultValue="lights" className="max-w-5xl">
      <TabsList aria-label="Venue areas">
        <TabsTrigger value="lights">Lights</TabsTrigger>
        <TabsTrigger value="room">Room mapping</TabsTrigger>
      </TabsList>
      <TabsContent value="lights"><VenueView /></TabsContent>
      <TabsContent value="room"><RoomVenueRoute /></TabsContent>
    </Tabs>
  );
}

export function RoomVenueRoute(): JSX.Element {
  const [room, setRoom] = useState<Room>(() => rectangleRoom(5, 5));
  const [saved, setSaved] = useState(false);
  const xs = room.outline.map((p) => p.x);
  const width = xs.length === 0 ? 5 : Math.round((Math.max(...xs) - Math.min(...xs)) * 10) / 10;
  return (
    <div className="flex flex-col gap-3">
      <section aria-label="Room editor" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Room editor</h2>
        <RoomCanvas room={room} onPatch={setRoom} />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            Width (m)
            <Input
              type="number"
              value={width}
              min={1}
              max={30}
              step={0.1}
              aria-label="Room width meters"
              className="w-20"
              onChange={(e) => {
                const w = Math.min(30, Math.max(1, Number(e.target.value) || 5));
                setRoom(rectangleRoom(w, 5));
              }}
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
              className="w-20"
              onChange={(e) => setRoom({ ...room, ceilingHeight: Number(e.target.value) || room.ceilingHeight })}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            DJ facing (deg)
            <Input
              type="number"
              value={Math.round((room.anchors.dj.facingRad * 180) / Math.PI)}
              step={5}
              aria-label="DJ facing degrees"
              className="w-20"
              onChange={(e) => setRoom({
                ...room,
                anchors: { ...room.anchors, dj: { ...room.anchors.dj, facingRad: ((Number(e.target.value) || 0) * Math.PI) / 180 } },
              })}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setSaved(true);
            }}
            className="rounded border px-2 py-1 text-sm"
          >
            Save room
          </button>
          {saved ? <span className="text-sm text-muted-foreground">Saved in memory; venue persistence exports the file.</span> : null}
        </div>
      </section>
      <MappingWizard onDone={() => setSaved(true)} />
      <RoomPreview roomId="square-loop" />
    </div>
  );
}
