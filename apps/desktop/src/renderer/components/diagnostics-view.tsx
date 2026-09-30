import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs.js";

const TABS = ["DJ Events", "Transport", "Beat Clock", "Analysis", "Planner", "Renderer", "Fixtures", "Latency", "Logs"];

// Diagnostics (§101): tab bar + panel; status only, never interrupts Live (§144).
export function DiagnosticsView(): JSX.Element {
  const [tab, setTab] = useState(TABS[0] ?? "DJ Events");
  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Diagnostics</CardTitle></CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex-wrap">
              {TABS.map((t) => <TabsTrigger key={t} value={t}>{t}</TabsTrigger>)}
            </TabsList>
            {TABS.map((t) => (
              <TabsContent key={t} value={t}>
                <p className="text-[13px] text-muted-foreground">
                  {t}: no events yet. Status only — Live keeps running.
                </p>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
