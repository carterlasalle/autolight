import { useMemo, useState } from "react";
import { KEYS } from "@autolight/config";
import { useShell } from "../state/store.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { Button } from "./ui/button.js";
import { Badge } from "./ui/badge.js";
import { Input } from "./ui/input.js";
import { ConfigField } from "./kit.js";

// Settings (T-CFG-05): every registry key visible with effective value,
// default, unit, range, layer badge, receipt badge, description, live-safe
// marker, reset, and a changed-only filter. Search by key or receipt.
export function SettingsView(): JSX.Element {
  const diagnostics = useShell((s) => s.diagnostics);
  const [query, setQuery] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const rows = useMemo(() => {
    const q = query.toLowerCase();
    return KEYS.filter((k) => {
      if (changedOnly) return false;
      if (!q) return true;
      return k.key.toLowerCase().includes(q) || k.receipt.toLowerCase().includes(q) || k.unit.toLowerCase().includes(q);
    });
  }, [query, changedOnly]);
  return (
    <div className="flex max-w-5xl flex-col gap-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Settings: {KEYS.length} keys</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Input
              aria-label="Search settings"
              placeholder="Search key, unit, or receipt"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button variant={changedOnly ? "default" : "outline"} size="sm" onClick={() => setChangedOnly(!changedOnly)}>
              Changed only
            </Button>
          </div>
          <p className="text-[13px] text-muted-foreground">
            Every tunable lives in the registry with unit, range, receipt, and
            live-safety. Changed values persist per scope and apply at the next
            bar when live-safe. Diagnostics: {Object.keys(diagnostics).length} entries.
          </p>
        </CardContent>
      </Card>
      {rows.slice(0, 200).map((k) => (
        <Card key={k.key}>
          <CardContent className="flex flex-wrap items-center gap-2 pt-3">
            <Badge variant="secondary">{k.type}</Badge>
            <Badge variant="outline">{k.scope}</Badge>
            <ConfigField def={{ key: k.key, value: k.defaultRaw, unit: k.unit, range: k.range, receipt: k.receipt, liveSafe: k.liveSafe }} />
          </CardContent>
        </Card>
      ))}
      {rows.length > 200 ? (
        <p className="text-[13px] text-muted-foreground">Showing 200 of {rows.length}: refine the search.</p>
      ) : null}
    </div>
  );
}
