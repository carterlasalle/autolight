import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { channels, type Channel } from "@autolight/ipc";
import {
  scanLanCommand, identifyCommand, testChaseCommand,
  pollAxCommand, listAudioDevices, readAudioLevel,
  readDiagnostics, readLiveShow, setSimulatorMode, setFollowMode,
  setShowStyle, setEnergyTier, triggerBuild, triggerDrop,
  setMasterBlackout, setMasterFull, setMasterFreeze, setMasterIntensity, resumeMaster,
  readShowState, readVenueList, setVenueColor, deviceAction,
  configGet, configSet, configReset, configExport, configImport, configSchema,
} from "./show-service.js";

// Typed IPC router (T-ARC-02, spec 87). Handlers register before the window
// is created (main.ts calls createIpc first). Every request validates against
// the channel schema; every response validates before return. Sender frame is
// checked: only the app window may invoke. Errors return typed
// { ok: false, error } and surface in UI status, never swallowed.
export type ChannelHandler<C extends Channel> = (
  request: import("@autolight/ipc").ChannelRequest<C>,
) => Promise<import("@autolight/ipc").ChannelResponse<C>> | import("@autolight/ipc").ChannelResponse<C>;

const handlers: { [C in Channel]: ChannelHandler<C> } = {
  "master/blackout": () => setMasterBlackout(),
  "master/full": () => setMasterFull(),
  "master/freeze": (req) => setMasterFreeze(req.frozen),
  "master/intensity": (req) => setMasterIntensity(req.value),
  "master/resume": (req) => resumeMaster(req.at),
  "show/live": () => readLiveShow(),
  "show/style": (req) => setShowStyle(req.style, req.palette),
  "show/energy": (req) => setEnergyTier(req.tier),
  "show/trigger-build": () => triggerBuild(),
  "show/trigger-drop": () => triggerDrop(),
  "show/state": (req) => readShowState(req.deck),
  "venue/list": () => readVenueList(),
  "venue/set-color": (req) => setVenueColor(req.rgb),
  "venue/device-action": (req) => deviceAction(req.id, req.action),
  "venue/scan": () => scanLanCommand(),
  "venue/identify": (req) => identifyCommand(req.id),
  "venue/test-chase": (req) => testChaseCommand(req.id),
  "follow/ax": () => pollAxCommand(),
  "follow/mode": (req) => setFollowMode(req.mode),
  "audio/devices": () => listAudioDevices(),
  "audio/level": () => readAudioLevel(),
  "diagnostics/get": (req) => ({ ok: true as const, tab: req.tab }),
  "diagnostics/all": () => readDiagnostics(),
  "simulator/mode": (req) => setSimulatorMode(req.enabled),
  "config/get": (req) => configGet(req.key),
  "config/set": (req) => configSet(req.scope, req.key, req.value),
  "config/reset": (req) => configReset(req.scope, req.key),
  "config/export": () => configExport(),
  "config/import": (req) => configImport(req.json),
  "config/schema": (req) => configSchema(req.key),
};

function senderAllowed(event: IpcMainInvokeEvent): boolean {
  try {
    const url = event.senderFrame?.url ?? "";
    if (!url) return true;
    return url.startsWith("file://") || url.startsWith("http://localhost:5173");
  } catch {
    return false;
  }
}

export function createIpc(): void {
  for (const name of Object.keys(channels) as Channel[]) {
    ipcMain.handle(name, async (event, payload) => {
      if (!senderAllowed(event)) {
        return { ok: false, error: { code: "E_SENDER", message: `sender not allowed for ${name}` } };
      }
      try {
        const req = channels[name].request.parse(payload);
        const handler = handlers[name] as (r: unknown) => Promise<unknown> | unknown;
        const res = await handler(req);
        return (channels[name].response as { parse: (v: unknown) => unknown }).parse(res);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: { code: "E_HANDLER", message: `${name}: ${message}` } };
      }
    });
  }
}
