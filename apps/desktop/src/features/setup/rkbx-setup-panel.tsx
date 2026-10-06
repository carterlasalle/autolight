// rkbx_link setup assistant panel (T-LIVE-04, F-LIVE-03 setup part).
//
// Presentational plus a thin container. RkbxSetupPanel renders a
// RkbxAssistantSnapshot built by summarizeRKBXAssistant; RkbxSetupAssistant
// owns the inputs (folder path from live.rkbx.configPath, pasted config
// text, installed version, platform, observed packets) and computes it.
//
// The panel never runs the re-sign script, never elevates, and never fetches
// the sidecar. It has no import capable of any of those: only the pure
// checking helpers plus the generic config IPC the whole app uses.
import { useEffect, useState } from "react";
import {
  RKBX_LINK_PROJECT_URL,
  RKBX_OS_NOTES,
  RKBX_RESIGN_COPY,
  RKBX_SUDO_COPY,
  summarizeRKBXAssistant,
  type RkbxAssistantSnapshot,
  type RkbxPlatform,
} from "@autolight/rekordbox-live/setup-assistant";
import { invoke } from "../../app/store.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { CapabilityBadge } from "../../components/kit.js";

function StepRow({ id, ok, detail }: { id: string; ok: boolean; detail: string }): JSX.Element {
  return (
    <li>
      <span aria-label={ok ? `${id} ok` : `${id} missing`}>{ok ? "✓ " : "✗ "}</span>
      <strong>{id}:</strong> {detail}
    </li>
  );
}

export function RkbxSetupPanel({ snapshot }: { snapshot: RkbxAssistantSnapshot }): JSX.Element {
  const { report } = snapshot;
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <CapabilityBadge capability="rkbx_link" status={snapshot.capability} />
        <span>State: {report.state}</span>
      </div>
      <ol aria-label="rkbx_link setup steps" className="flex list-decimal flex-col gap-1.5 pl-5">
        {report.steps.map((step) => (
          <StepRow key={step.id} id={step.id} ok={step.ok} detail={step.detail} />
        ))}
      </ol>
      {report.remedy ? <p>Next step: {report.remedy}</p> : <p>Receiving packets. No further setup needed.</p>}
      <dl className="flex flex-col gap-1">
        <div className="flex gap-2"><dt>Folder:</dt><dd>{snapshot.configPath || "none selected"}</dd></div>
        <div className="flex gap-2"><dt>OSC destination:</dt><dd>{snapshot.destination ?? "not found"} (expected {snapshot.expectedDestination})</dd></div>
        <div className="flex gap-2"><dt>Rekordbox:</dt><dd>{snapshot.installedVersion || "unknown"}</dd></div>
        <div className="flex gap-2"><dt>OS support:</dt><dd>{RKBX_OS_NOTES[snapshot.platform]}</dd></div>
        <div className="flex gap-2"><dt>Packets:</dt><dd>{snapshot.packets.received} received, {snapshot.packets.updateHz.toFixed(1)} Hz, last {snapshot.packets.lastAddress ?? "none"}</dd></div>
      </dl>
      <p>{RKBX_RESIGN_COPY}</p>
      <p>{RKBX_SUDO_COPY}</p>
      <p>Decide with the project docs: <a href={RKBX_LINK_PROJECT_URL}>{RKBX_LINK_PROJECT_URL}</a></p>
    </div>
  );
}

export function RkbxSetupAssistant(): JSX.Element {
  const [configPath, setConfigPath] = useState("");
  const [configText, setConfigText] = useState("");
  const [oscBind, setOscBind] = useState("127.0.0.1:4460");
  const [installedVersion, setInstalledVersion] = useState("");
  const [platform, setPlatform] = useState<RkbxPlatform>("macos");
  const [received, setReceived] = useState(0);
  const [updateHz, setUpdateHz] = useState(0);
  const [lastAddress, setLastAddress] = useState("");

  useEffect(() => {
    let cancelled = false;
    void invoke("config/get", { version: 1, key: "live.rkbx.configPath" }).then((raw: unknown) => {
      if (cancelled) return;
      const envelope = raw as { ok?: boolean; value?: unknown } | null;
      if (envelope && envelope.ok !== false && typeof envelope.value === "string" && envelope.value.length > 0) {
        setConfigPath(envelope.value);
      }
    });
    void invoke("config/get", { version: 1, key: "live.rkbx.oscBind" }).then((raw: unknown) => {
      if (cancelled) return;
      const envelope = raw as { ok?: boolean; value?: unknown } | null;
      if (envelope && envelope.ok !== false && typeof envelope.value === "string" && envelope.value.length > 0) {
        setOscBind(envelope.value);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const snapshot = summarizeRKBXAssistant({
    configPath,
    configText: configText.length > 0 ? configText : (configPath.trim().length > 0 ? "" : null),
    expectedDestination: oscBind,
    installedVersion,
    platform,
    packets: { received, updateHz, lastAddress: lastAddress.length > 0 ? lastAddress : null },
  });

  const savePath = (): void => {
    void invoke("config/set", { version: 1, scope: "app", key: "live.rkbx.configPath", value: configPath });
  };

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-[13px]">rkbx_link setup assistant</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-[13px] text-muted-foreground">
          Point the assistant at your rkbx_link folder, paste its config file contents, and it checks
          each step. The app never reads your disk on its own: it only uses the folder you set here.
        </p>
        <label className="flex flex-col gap-1 text-[13px]">
          rkbx_link folder (live.rkbx.configPath)
          <span className="flex items-center gap-2">
            <Input aria-label="rkbx_link folder" value={configPath} onChange={(e) => setConfigPath(e.target.value)} placeholder="/Users/you/rkbx_link" />
            <Button size="sm" onClick={savePath}>Save</Button>
          </span>
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          rkbx_link config file contents (pasted, never fetched by the app)
          <textarea
            aria-label="rkbx_link config contents"
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            rows={4}
            data-sample="osc_enabled = true&#10;osc_dest = 127.0.0.1:4460"
            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-[13px] outline-none sample:text-muted-foreground"
          />
        </label>
        {configPath.trim().length > 0 && configText.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Folder set, but no config text pasted yet: the OSC checks below read the pasted text.</p>
        ) : null}
        <span className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-[13px]">
            Rekordbox version
            <Input aria-label="Installed Rekordbox version" value={installedVersion} onChange={(e) => setInstalledVersion(e.target.value)} placeholder="7.2.17" className="w-28" />
          </label>
          <label className="flex items-center gap-1 text-[13px]">
            OS
            <select aria-label="OS" value={platform} onChange={(e) => setPlatform(e.target.value as RkbxPlatform)} className="h-8 rounded-lg border border-input bg-transparent px-2 text-[13px]">
              <option value="macos">macOS</option>
              <option value="windows">Windows</option>
            </select>
          </label>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-[13px]">
            Packets observed
            <Input aria-label="Packets observed" type="number" value={received} onChange={(e) => setReceived(Number(e.target.value))} className="w-24" />
          </label>
          <label className="flex items-center gap-1 text-[13px]">
            Rate (Hz)
            <Input aria-label="Packet rate Hz" type="number" value={updateHz} onChange={(e) => setUpdateHz(Number(e.target.value))} className="w-24" />
          </label>
          <label className="flex items-center gap-1 text-[13px]">
            Last address
            <Input aria-label="Last address seen" value={lastAddress} onChange={(e) => setLastAddress(e.target.value)} placeholder="/1/time" className="w-32" />
          </label>
        </span>
        <RkbxSetupPanel snapshot={snapshot} />
      </CardContent>
    </Card>
  );
}
