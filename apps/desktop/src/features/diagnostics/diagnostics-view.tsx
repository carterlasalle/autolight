import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs.js";
import { invoke, useShell } from "../../app/store.js";
import { deckBpm } from "../../components/kit.js";
import { DIAGNOSTIC_TABS, djEventRow, isFresh, type DjEventRow } from "../../routes/diagnostics/diagnostics-model.js";

function renderBpm(bpm: number | null): string {
  return bpm === null ? "-- BPM" : `${deckBpm(bpm)} BPM`;
}

// Per-tab metric rows: each tab names the rows it owns; anything else falls
// back to the stored string. Labels stay stable so a glance finds them.
const TAB_ROWS: Record<string, string[]> = {
  Transport: ["DJ link"],
  "Beat Clock": ["Beat clock"],
  Analysis: ["Track", "Analysis"],
  Planner: ["Plan"],
  Renderer: ["Renderer"],
  Fixtures: ["Lights"],
  Latency: ["Latency"],
  Logs: ["Session"],
  "Track Resolver": ["Track"],
};

function TabMetrics({ tab, rows, fallback, sessionEvents }: {
  tab: string; rows: { label: string; value: string }[]; fallback: string | undefined; sessionEvents: number;
}): JSX.Element {
  if (tab === "Logs") {
    return <p className="font-timing text-[13px] tabular-nums">Session events: {sessionEvents}</p>;
  }
  const wanted = TAB_ROWS[tab] ?? [];
  const found = rows.filter((r) => wanted.includes(r.label));
  if (found.length === 0) {
    return <p className="text-[13px] text-muted-foreground">{fallback ?? `${tab}: loading…`}</p>;
  }
  return (
    <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
      {found.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className="font-timing tabular-nums">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DiagnosticsView(): JSX.Element {
  const [tab, setTab] = useState<string>(DIAGNOSTIC_TABS[0] ?? "DJ Events");
  const live = useShell((s) => s.live);
  const bpm = useShell((s) => s.bpm);
  const devices = useShell((s) => s.devices);
  const diagnostics = useShell((s) => s.diagnostics);
  const set = useShell((s) => s.set);
  const [events, setEvents] = useState<DjEventRow[]>([]);
  const [seenAt, setSeenAt] = useState<number | null>(null);
  const [sessionEvents, setSessionEvents] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void invoke("diagnostics/all", { version: 1 }).then((raw: unknown) => {
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
      if (typeof d?.events === "number") setSessionEvents(d.events);
    });
    return () => { cancelled = true; };
  }, [live, bpm, devices, set]);
  const stale = seenAt !== null && !isFresh(seenAt, Date.now());
  const rows: { label: string; value: string }[] = [
    { label: "DJ link", value: live ? `${live.source} · deck 1 ${live.deckA.title}` : "No DJ link" },
    { label: "Beat clock", value: live?.beat !== undefined ? `beat ${deckBpm(live.beat)} @ ${renderBpm(bpm)}` : "No clock — load a track" },
    { label: "Track", value: live ? `${live.deckA.title} resolved` : "No track" },
    { label: "Analysis", value: live ? "ANLZ grid + plan resolved" : "No track" },
    { label: "Plan", value: live ? `${live.cues.length} upcoming cues` : "No plan" },
    { label: "Renderer", value: live ? `${live.cells.length} cells` : "No frames" },
    { label: "Lights", value: devices.length > 0 ? devices.map((x) => x.address).join(", ") : "No lights — scan the LAN" },
    { label: "Latency", value: "devStatus read-back verified per command" },
  ];
  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[13px]">
            Diagnostics{stale ? " · stale" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex-wrap" aria-label="Diagnostic areas">
              {DIAGNOSTIC_TABS.map((t) => <TabsTrigger key={t} value={t}>{t}</TabsTrigger>)}
            </TabsList>
            {DIAGNOSTIC_TABS.map((t) => (
              <TabsContent key={t} value={t}>
                {t === "DJ Events" ? (
                  events.length > 0 ? (
                    <table aria-label="DJ events" className="w-full border-collapse text-[13px]">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th scope="col" className="border-b py-1.5 pr-3 font-medium">Time</th>
                          <th scope="col" className="border-b py-1.5 pr-3 font-medium">Source</th>
                          <th scope="col" className="border-b py-1.5 pr-3 font-medium">Deck</th>
                          <th scope="col" className="border-b py-1.5 font-medium">Event</th>
                        </tr>
                      </thead>
                      <tbody className="font-timing tabular-nums">
                        {events.map((e, i) => (
                          <tr key={i}>
                            <td className="border-b py-1.5 pr-3">{new Date(e.timestampMs).toLocaleTimeString()}</td>
                            <td className="border-b py-1.5 pr-3">{e.source}</td>
                            <td className="border-b py-1.5 pr-3">{e.deck}</td>
                            <td className="border-b py-1.5">{e.event}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-[13px] text-muted-foreground">No DJ events yet. Load a track and press play — events record to .ndjson.</p>
                  )
                ) : (
                  <TabMetrics tab={t} rows={rows} fallback={diagnostics[t]} sessionEvents={sessionEvents} />
                )}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
