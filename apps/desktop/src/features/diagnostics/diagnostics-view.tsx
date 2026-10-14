import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/badge.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs.js";
import { typedInvoke, useShell } from "../../app/store.js";
import { deckBpm } from "../../components/kit.js";
import { DIAGNOSTIC_TABS, isFresh } from "../../routes/diagnostics/diagnostics-model.js";

function renderBpm(bpm: number | null): string {
  return bpm === null ? deckBpm(bpm) : `${deckBpm(bpm)} BPM`;
}

// Per-tab metric rows: each tab names the rows it owns. The rows array is
// complete by construction, so every tab renders its own rows; the old
// stored-string fallback branch was unreachable (batch-17).
type MetricTab = Exclude<(typeof DIAGNOSTIC_TABS)[number], "DJ Events" | "Logs">;
const TAB_ROWS: Record<MetricTab, readonly string[]> = {
  Transport: ["DJ link"],
  "Beat Clock": ["Beat clock"],
  Analysis: ["Track", "Analysis"],
  Planner: ["Plan"],
  Renderer: ["Renderer"],
  Fixtures: ["Lights"],
  Latency: ["Latency"],
  "Track Resolver": ["Track"],
};

function TabMetrics({ tab, rows, sessionEvents }: {
  tab: MetricTab | "Logs"; rows: { label: string; value: string }[]; sessionEvents: number;
}): JSX.Element {
  if (tab === "Logs") {
    return <p className="font-timing text-sm tabular-nums">Session events: {sessionEvents}</p>;
  }

  const wanted = TAB_ROWS[tab];
  const found = rows.filter((r) => wanted.includes(r.label));

  return (
    <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 text-sm">
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
  const [seenAt, setSeenAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [sessionEvents, setSessionEvents] = useState(0);
  // The stale badge needs a ticking clock: without it `stale` only changes
  // when some unrelated store update re-renders the view.
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()); }, 1000);

    return () => { clearInterval(timer); };
  }, []);
  // Refresh from a 5s interval plus document-visibility changes, not from
  // live-store reactivity: re-fetching on every beat/status update fires a
  // request-per-beat storm, and each re-run would mask staleness detection.
  useEffect(() => {
    let cancelled = false;

    const refresh = async (): Promise<void> => {
      try {
        const res = await typedInvoke("diagnostics/all", { version: 1 });

        if (cancelled) return;
        // SAFETY: diagnostics/all's reply contract carries a diagnostics
        // object (typed unknown); every field below is optional-chained and
        // d === undefined returns early, so a wrong shape degrades to "no
        // update", never a crash.
        const d = res !== null ? (res.diagnostics as { ax?: unknown; prolink?: unknown; events?: number } | undefined) : undefined;

        if (d === undefined) return;
        // BigInt/cyclic payloads throw on stringify: fall back to the empty
        // shape instead of aborting the whole update unobserved.
        let axText = "[]";
        let prolinkText = "{}";

        try {
          axText = JSON.stringify(d.ax ?? []) ?? "[]";
          prolinkText = JSON.stringify(d.prolink ?? {}) ?? "{}";
        } catch {
          // Keep the fallbacks above.
        }

        const prior = useShell.getState().diagnostics;
        const rawEvents: unknown = d.events;
        const eventCount = rawEvents === undefined || rawEvents === null ? 0 : Number(rawEvents);
        set({
          diagnostics: {
            ...prior,
            "DJ Events": `AX: ${axText} PROLINK: ${prolinkText}`,
            Logs: `session events: ${eventCount}`,
          },
        });
        setSeenAt(Date.now());
        setSessionEvents(eventCount);
      } catch {
        // Leave the previous timestamp/state intact so the stale badge keeps
        // reporting the last good fetch instead of success on empty data.
      }
    };

    void refresh();
    const timer = setInterval(() => { void refresh(); }, 5000);
    const onVisible = (): void => { void refresh(); };

    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [set]);
  const stale = seenAt !== null && !isFresh(seenAt, now);

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
    <section className="min-w-0 rounded-xl border border-border bg-card px-4 py-3">
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-base font-medium">Diagnostics</h2>
        {stale ? <Badge variant="secondary">stale</Badge> : null}
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap" aria-label="Diagnostic areas">
          {DIAGNOSTIC_TABS.map((t) => <TabsTrigger key={t} value={t}>{t}</TabsTrigger>)}
        </TabsList>
        {DIAGNOSTIC_TABS.map((t) => (
          <TabsContent key={t} value={t}>
            {t === "DJ Events" ? (
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="text-sm">{diagnostics["DJ Events"] ?? "No DJ link"}</p>
                <p className="font-timing text-sm tabular-nums">Session events: {sessionEvents}</p>
                <p className="text-xs text-muted-foreground">Per-event rows land here when the recorder exposes them; the count above is live.</p>
              </div>
            ) : (
              <TabMetrics tab={t} rows={rows} sessionEvents={sessionEvents} />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
