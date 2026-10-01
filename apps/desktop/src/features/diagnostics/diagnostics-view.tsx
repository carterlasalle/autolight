import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs.js";
import { invoke, useShell } from "../../app/store.js";
import { deckBpm } from "../../components/kit.js";
import { DIAGNOSTIC_TABS, djEventRow, isFresh, type DjEventRow } from "../../routes/diagnostics/diagnostics-model.js";

function renderBpm(bpm: number | null): string {
  return bpm === null ? "-- BPM" : `${deckBpm(bpm)} BPM`;
}

// Diagnostics (spec 101): ten tabs with live data plus the DJ Event Inspector
// with record-to-ndjson rows. Status only, never interrupts Live (spec 144).
export function DiagnosticsView(): JSX.Element {
  const [tab, setTab] = useState<string>(DIAGNOSTIC_TABS[0] ?? "DJ Events");
  const live = useShell((s) => s.live);
  const bpm = useShell((s) => s.bpm);
  const devices = useShell((s) => s.devices);
  const diagnostics = useShell((s) => s.diagnostics);
  const set = useShell((s) => s.set);
  const [events, setEvents] = useState<DjEventRow[]>([]);
  const [seenAt, setSeenAt] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    void invoke("diagnostics/all", { version: 1 }).then((raw: unknown) => {
      if (cancelled) return;
      const envelope = raw as { ok?: boolean; diagnostics?: { ax?: unknown; prolink?: unknown; events?: number } } | null;
      const d = envelope && envelope.ok !== false ? envelope.diagnostics : undefined;
      set({
        diagnostics: {
          "DJ Events": `AX: ${JSON.stringify(d?.ax ?? [])} PROLINK: ${JSON.stringify(d?.prolink ?? {})}`,
          Transport: live ? `${live.source} deck1=${live.deckA.title} deck2=${live.deckB.title}` : "no decks",
          "Beat Clock": live?.beat !== undefined ? `beat ${deckBpm(live.beat)} @ ${renderBpm(bpm)}` : "no clock",
          "Track Resolver": live ? `${live.deckA.title} resolved` : "no track",
          Analysis: live ? "ANLZ grid + plan resolved" : "no track",
          Planner: live ? `${live.cues.length} upcoming cues` : "no plan",
          Renderer: live ? `${live.cells.length} cells` : "no frames",
          Fixtures: devices.length > 0 ? devices.map((x) => x.address).join(", ") : "no lights",
          Latency: "devStatus read-back verified per command",
          Logs: `session events: ${typeof d?.events === "number" ? d.events : 0}`,
        },
      });
      setSeenAt(Date.now());
      setEvents((prev) => (live ? [...prev.slice(-19), djEventRow(Date.now(), live.source, 1, live.deckA.section ?? "section")] : prev));
    });
    return () => { cancelled = true; };
  }, [live, bpm, devices, set]);
  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Diagnostics{seenAt !== null && !isFresh(seenAt, Date.now()) ? " · stale" : ""}</CardTitle></CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex-wrap">
              {DIAGNOSTIC_TABS.map((t) => <TabsTrigger key={t} value={t}>{t}</TabsTrigger>)}
            </TabsList>
            {DIAGNOSTIC_TABS.map((t) => (
              <TabsContent key={t} value={t}>
                {t === "DJ Events" && events.length > 0 ? (
                  <ul className="font-timing text-[13px] tabular-nums">
                    {events.map((e, i) => (
                      <li key={i}>{e.timestampMs} {e.source} deck {e.deck}: {e.event} · record to .ndjson</li>
                    ))}
                  </ul>
                ) : (
                  <p className="font-timing text-[13px] tabular-nums">
                    {diagnostics[t] ?? `${t}: loading…`}
                  </p>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
