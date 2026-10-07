// Diagnostics Environment panel (T-OPS-01): renders detection facts passed
// in as props only. No store, no IPC, no imports from other screens, so it
// mounts standalone inside Diagnostics or any host.
export interface EnvironmentFacts {
  electron: string;
  node: string;
  chrome: string;
  os: string;
  cpu: string;
}

export interface EnvironmentOwnerFacts {
  macModel?: string;
  macChip?: string;
  macOs?: string;
  rekordbox?: string;
  serato?: string;
  flx4Firmware?: string;
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-timing text-xs tabular-nums">{value || "unknown"}</dd>
    </div>
  );
}

export function EnvironmentPanel({
  facts,
  owner,
}: {
  facts: EnvironmentFacts;
  owner?: EnvironmentOwnerFacts;
}): JSX.Element {
  return (
    <section aria-label="Environment" className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium">Runtime (detected)</h3>
        <dl className="divide-y divide-border">
          <Row label="Electron" value={facts.electron} />
          <Row label="Node" value={facts.node} />
          <Row label="Chrome" value={facts.chrome} />
          <Row label="OS" value={facts.os} />
          <Row label="CPU" value={facts.cpu} />
        </dl>
      </div>
      {owner !== undefined ? (
        <div>
          <h3 className="text-sm font-medium">Owner rig (recorded)</h3>
          <dl className="divide-y divide-border">
            <Row label="Mac" value={owner.macModel ?? ""} />
            <Row label="Chip" value={owner.macChip ?? ""} />
            <Row label="macOS" value={owner.macOs ?? ""} />
            <Row label="Rekordbox" value={owner.rekordbox ?? ""} />
            <Row label="Serato" value={owner.serato ?? ""} />
            <Row label="FLX4 firmware" value={owner.flx4Firmware ?? ""} />
          </dl>
        </div>
      ) : null}
    </section>
  );
}
