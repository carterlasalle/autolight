import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { Button } from "./ui/button.js";
import { inspectorLanes } from "../library.js";
import type { TrackModel } from "@autolight/contracts";

// Inspector (§96): synchronized beat lanes; click a beat to audition.
// Audition is local preview only — never touches the live show.
export function InspectorView(): JSX.Element {
  const [beat, setBeat] = useState<number | null>(null);
  const lanes = inspectorLanes({
    schemaVersion: 1, analyzerVersion: "t",
    identity: { id: "demo", sourceIds: {} }, durationSeconds: 200,
    beatGrid: { version: 1, beats: [{ index: 0, beatInBar: 1 as const, sourceTimeMs: 0, bpm: 128 }] },
    sections: [{ kind: "chorus" as const, startBeat: 0, endBeat: 32, confidence: 0.9 }],
    musicalEvents: [{ type: "drop" as const, beat: 32, confidence: 0.9 }],
    analysisCoverage: "structured",
  } as TrackModel);
  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Track inspector</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2.5">
          {lanes.map((lane) => (
            <div key={lane.name} aria-label={lane.name} className="flex flex-col gap-1">
              <p className="text-xs font-medium text-muted-foreground">{lane.name}</p>
              <div className="flex flex-wrap gap-1">
                {lane.beats.map((b, i) => (
                  <Button
                    key={i} type="button" variant={beat === i ? "secondary" : "outline"} size="sm" className="h-6 px-1.5 text-xs"
                    onClick={() => {
                      setBeat(i);
                      toast(`Auditioning beat ${i} (preview only)`);
                    }}
                  >
                    {String(b ?? "·")}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
