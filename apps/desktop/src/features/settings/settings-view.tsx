import { useEffect, useMemo, useState } from "react";
// Registry only (pure zod, no node: imports). The barrel re-exports the
// file-backed store and blank-screens dev the same way dgram did.
import { KEYS } from "@autolight/config/registry";
import { configScopes, type ConfigScope } from "@autolight/ipc";
import { useShell, typedInvoke } from "../../app/store.js";
import { Button } from "../../components/ui/button.js";
import { Badge } from "../../components/ui/badge.js";
import { Input } from "../../components/ui/input.js";
import { ConfigField } from "../../components/kit.js";
import { routeConfigChange, settingsGroup, type PendingChange } from "../../routes/diagnostics/diagnostics-model.js";

const PENDING_KEY = "autolight.settings.pending";

/** True when the value is one of the config layer names (narrowing guard). */
function isConfigScope(v: unknown): v is ConfigScope {
  return configScopes.some((s) => s === v);
}

function loadPending(): PendingChange[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY);

    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    return parsed.filter((p): p is PendingChange =>
      typeof p === "object" && p !== null && "key" in p && "scope" in p && typeof p.key === "string" && isConfigScope(p.scope));
  } catch {
    return [];
  }
}

function savePending(next: PendingChange[]): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(next));
  } catch { /* private mode: queue stays in memory for the session */ }
}

// Settings (T-UI-11, T-CFG-05): every registry key visible with effective
// value, default, unit, range, receipt, live-safe badge, reset, and per-scope
// editing. Non-live-safe edits queue while Live is active with a visible
// pending list (T-CFG-07). Search by key or receipt; grouped by prefix.
export function SettingsView(): JSX.Element {
  const live = useShell((s) => s.live);
  const [query, setQuery] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [pending, setPending] = useState<PendingChange[]>(() => loadPending());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { savePending(pending); }, [pending]);

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

  const commit = (key: string, scope: ConfigScope, liveSafe: boolean): void => {
    const value = edits[key];

    if (value === undefined) return;

    const routing = routeConfigChange({ key, scope, value, liveSafe }, live !== null);

    if (routing === "queue-until-live-ends") {
      setPending((prev) => [...prev.filter((p) => p.key !== key), { key, scope, value, liveSafe }]);

      return;
    }

    void typedInvoke("config/set", { version: 1, scope, key, value }).then((res) => {
      if (res === null) {
        setErrors((prev) => ({ ...prev, [key]: "Write failed — value kept. Retry Set." }));

        return;
      }

      setEdits((prev) => {
        const next = { ...prev };
        delete next[key];

        return next;
      });
    });
  };

  const resetRow = (key: string, scope: ConfigScope): void => {
    void typedInvoke("config/reset", { version: 1, scope, key }).then((res) => {
      if (res === null) {
        setErrors((prev) => ({ ...prev, [key]: "Reset failed — value unchanged." }));

        return;
      }

      setErrors((prev) => {
        if (prev[key] === undefined) return prev;

        const next = { ...prev };
        delete next[key];

        return next;
      });
      setEdits((prev) => {
        if (prev[key] === undefined) return prev;

        const next = { ...prev };
        delete next[key];

        return next;
      });
    });
  };

  const applyPending = (): void => {
    for (const p of pending) {
      void typedInvoke("config/set", { version: 1, scope: p.scope, key: p.key, value: p.value }).then((res) => {
        if (res === null) return;

        setPending((prev) => prev.filter((q) => q.key !== p.key));
        setEdits((prev) => {
          if (prev[p.key] === undefined) return prev;

          const next = { ...prev };
          delete next[p.key];

          return next;
        });
      });
    }
  };

  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <section aria-label="Settings search and filters" className="rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Input
              aria-label="Search settings"
              placeholder="Search key, unit, or receipt"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-w-0 flex-1"
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
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={`${pending.length} change(s) pending until Live ends`}>Pending until Live ends: {pending.length}</p>
              {live === null ? <Button size="sm" variant="outline" onClick={applyPending}>Apply pending</Button> : null}
            </div>
          ) : null}
        </div>
      </section>
      {groups.map(([group, keys]) => (
        <section key={group} id={`settings-${group}`} aria-label={`${group} settings`} className="scroll-mt-24 rounded-xl border border-border bg-card px-4 py-3">
          <h2 className="text-base font-medium">{group} · {keys.length}{keys.length > 500 ? ` (showing first 500 — refine search to reach the rest)` : ""}</h2>
          <div className="mt-2 flex flex-col gap-2">
            {keys.slice(0, 500).map((k) => (
              <div key={k.key} className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge variant="secondary">{k.type}</Badge>
                <Badge variant="outline">{k.scope}</Badge>
                <ConfigField def={{ key: k.key, value: edits[k.key] ?? k.defaultRaw, unit: k.unit, range: k.range, receipt: k.receipt, liveSafe: k.liveSafe }} />
                <Input aria-label={`Edit ${k.key}`} placeholder="new value" value={edits[k.key] ?? ""} onChange={(e) => setEdits((prev) => ({ ...prev, [k.key]: e.target.value }))} className="h-8 min-w-0 flex-1" />
                <Button size="sm" variant="outline" onClick={() => commit(k.key, k.scope, k.liveSafe)}>Set</Button>
                <Button size="sm" variant="ghost" onClick={() => resetRow(k.key, k.scope)}>Reset</Button>
                {errors[k.key] ? <p role="alert" className="w-full text-xs text-destructive">{errors[k.key]}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
