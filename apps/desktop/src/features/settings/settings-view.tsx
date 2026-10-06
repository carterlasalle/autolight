import { useMemo, useState } from "react";
// Registry only (pure zod, no node: imports). The barrel re-exports the
// file-backed store and blank-screens dev the same way dgram did.
import { KEYS } from "@autolight/config/registry";
import { useShell, invoke } from "../../app/store.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Button } from "../../components/ui/button.js";
import { Badge } from "../../components/ui/badge.js";
import { Input } from "../../components/ui/input.js";
import { ConfigField } from "../../components/kit.js";
import { routeConfigChange, settingsGroup, type PendingChange } from "../../routes/diagnostics/diagnostics-model.js";
// Settings (T-UI-11, T-CFG-05): every registry key visible with effective
// value, default, unit, range, receipt, live-safe badge, reset, and per-scope
// editing. Non-live-safe edits queue while Live is active with a visible
// pending list (T-CFG-07). Search by key or receipt; grouped by prefix.
export function SettingsView(): JSX.Element {
  const live = useShell((s) => s.live);
  const [query, setQuery] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const rows = useMemo(() => {
    const q = query.toLowerCase();
    return KEYS.filter((k) => {
      if (changedOnly) return edits[k.key] !== undefined;
      if (!q) return true;
      return k.key.toLowerCase().includes(q) || k.receipt.toLowerCase().includes(q) || k.unit.toLowerCase().includes(q);
    });
  }, [query, changedOnly, edits]);
  const groups = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const k of rows) {
      const g = settingsGroup(k.key);
      const list = map.get(g);
      if (list) list.push(k);
      else map.set(g, [k]);
    }
    return [...map.entries()];
  }, [rows]);
  const commit = (key: string, scope: "app" | "venue" | "device" | "style" | "session", liveSafe: boolean): void => {
    const value = edits[key] ?? "";
    const routing = routeConfigChange({ key, scope, value, liveSafe }, live !== null);
    if (routing === "queue-until-live-ends") {
      setPending((prev) => [...prev.filter((p) => p.key !== key), { key, scope, value, liveSafe }]);
      return;
    }
    void invoke("config/set", { version: 1, scope, key, value });
    setEdits((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };
  const applyPending = (): void => {
    for (const p of pending) void invoke("config/set", { version: 1, scope: p.scope, key: p.key, value: p.value });
    setPending([]);
  };
  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <Card className="sticky top-0 z-10">
        <CardContent className="flex flex-col gap-2 pt-4">
          <div className="flex items-center gap-2">
            <Input
              aria-label="Search settings"
              placeholder="Search key, unit, or receipt"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button variant={changedOnly ? "default" : "outline"} size="sm" onClick={() => setChangedOnly(!changedOnly)} aria-pressed={changedOnly}>
              Changed only
            </Button>
          </div>
          <nav aria-label="Setting groups" className="flex flex-wrap gap-1.5">
            {groups.map(([group, keys]) => (
              <a key={group} href={`#settings-${group}`} className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground">
                {group} · {keys.length}
              </a>
            ))}
          </nav>
          {pending.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] text-muted-foreground">Pending until Live ends: {pending.length}</p>
              {live === null ? <Button size="sm" variant="outline" onClick={applyPending}>Apply pending</Button> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
      {groups.map(([group, keys]) => (
        <section key={group} id={`settings-${group}`} aria-label={`${group} settings`} className="scroll-mt-24">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-[13px]">{group} · {keys.length}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            {keys.slice(0, 200).map((k) => (
              <div key={k.key} className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{k.type}</Badge>
                <Badge variant="outline">{k.scope}</Badge>
                <ConfigField def={{ key: k.key, value: edits[k.key] ?? k.defaultRaw, unit: k.unit, range: k.range, receipt: k.receipt, liveSafe: k.liveSafe }} />
                <Input aria-label={`Edit ${k.key}`} placeholder="new value" value={edits[k.key] ?? ""} onChange={(e) => setEdits((prev) => ({ ...prev, [k.key]: e.target.value }))} className="h-8 w-40" />
                <Button size="sm" variant="outline" onClick={() => commit(k.key, k.scope, k.liveSafe)}>Set</Button>
                <Button size="sm" variant="ghost" onClick={() => { void invoke("config/reset", { version: 1, scope: k.scope, key: k.key }); }}>Reset</Button>
              </div>
            ))}
          </CardContent>
        </Card>
        </section>
      ))}
    </div>
  );
}
