import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";

// Inspector (§96): synchronized beat lanes for the resolved track.
// Empty until analysis lands — no sample model, no fake beats.
export function InspectorView(): JSX.Element {
  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Track inspector</CardTitle></CardHeader>
        <CardContent>
          <p className="text-[13px] text-muted-foreground">No track analyzed yet. Lanes for waveform, grid, sections, events, and cues appear after the analysis worker finishes a loaded deck.</p>
        </CardContent>
      </Card>
    </div>
  );
}
