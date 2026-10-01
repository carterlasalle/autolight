import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { channels, type Channel, type ChannelRequest, type ChannelResponse } from "@autolight/ipc";
import {
  scanLanCommand, identifyCommand, testChaseCommand,
  listAudioDevices, readAudioLevel,
  readDiagnostics, readLiveShow, setSimulatorMode, setFollowMode,
  setShowStyle, setEnergyTier, triggerBuild, triggerDrop,
  setMasterBlackout, setMasterFull, setMasterFreeze, setMasterIntensity, resumeMaster,
  readShowState, readVenueList, setVenueColor, deviceAction,
} from "./../show-service.js";
import { ServiceTracker, type Service, type ServiceStatus } from "./base.js";
import { getConfigService } from "./config-service.js";
import { getProviderManager } from "./provider-manager.js";

// ipc-router (T-ARC-02, spec 87; moved here from electron/ipc.ts by T-ARC-05):
// typed channels only, sender checked, request and response validated. Main
// registers it before the window is created. Errors return typed
// { ok: false, error } and surface in UI status, never swallowed.

export interface IpcEventLike {
  senderFrame?: { url?: string } | null;
}

// The router talks to this port instead of ipcMain so the whole channel table
// is testable without an Electron process.
export interface IpcMainPort {
  handle(channel: string, listener: (event: IpcEventLike, payload: unknown) => Promise<unknown>): void;
  removeHandler(channel: string): void;
}

export type ChannelHandler<C extends Channel> = (
  request: ChannelRequest<C>,
) => Promise<ChannelResponse<C>> | ChannelResponse<C>;

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
  // AX polling moved to provider-manager with follow.ts (T-ARC-05).
  "follow/ax": async () => ({ ok: true as const, readings: await getProviderManager().pollOnce() }),
  "follow/mode": (req) => setFollowMode(req.mode),
  "audio/devices": () => listAudioDevices(),
  "audio/level": () => readAudioLevel(),
  "diagnostics/get": (req) => ({ ok: true as const, tab: req.tab }),
  "diagnostics/all": () => readDiagnostics(),
  "simulator/mode": (req) => setSimulatorMode(req.enabled),
  // Config channels go through config-service, the single owner of the layer
  // stack and its file (T-ARC-05).
  "config/get": async (req) => (await getConfigService()).get(req.key),
  "config/set": async (req) => (await getConfigService()).set(req.scope, req.key, req.value),
  "config/reset": async (req) => (await getConfigService()).reset(req.scope, req.key),
  "config/export": async () => (await getConfigService()).exportJson(),
  "config/import": async (req) => (await getConfigService()).importJson(req.json),
  "config/schema": async (req) => (await getConfigService()).schema(req.key),
};

export class IpcRouter implements Service {
  readonly name = "ipc-router";
  private readonly tracker = new ServiceTracker("ipc-router");
  private registered = false;

  constructor(private readonly port: IpcMainPort) {}

  start(): ServiceStatus {
    if (!this.registered) {
      for (const name of Object.keys(channels) as Channel[]) {
        this.port.handle(name, (event, payload) => this.dispatch(name, event, payload));
      }
      this.registered = true;
      this.tracker.count("registrations");
    }
    this.tracker.setCounter("channels", Object.keys(channels).length);
    this.tracker.setCounter("registered", this.registered ? 1 : 0);
    this.tracker.set("running", `${Object.keys(channels).length} typed channels registered`);
    return this.status();
  }

  stop(): ServiceStatus {
    if (this.registered) {
      for (const name of Object.keys(channels) as Channel[]) this.port.removeHandler(name);
      this.registered = false;
    }
    this.tracker.set("stopped");
    return this.status();
  }

  status(): ServiceStatus {
    this.tracker.setCounter("channels", Object.keys(channels).length);
    this.tracker.setCounter("registered", this.registered ? 1 : 0);
    return this.tracker.status();
  }

  private senderAllowed(event: IpcEventLike): boolean {
    try {
      const url = event.senderFrame?.url ?? "";
      if (!url) return true;
      return url.startsWith("file://") || url.startsWith("http://localhost:5173");
    } catch {
      return false;
    }
  }

  private async dispatch(name: Channel, event: IpcEventLike, payload: unknown): Promise<unknown> {
    if (!this.senderAllowed(event)) {
      this.tracker.count("denied");
      return { ok: false, error: { code: "E_SENDER", message: `sender not allowed for ${name}` } };
    }
    try {
      const req = channels[name].request.parse(payload);
      // The handler table is invariant in its channel parameter; the request
      // above was validated against channels[name].request for this channel.
      const runHandler = handlers[name] as (r: unknown) => Promise<unknown> | unknown;
      const res = await runHandler(req);
      const responseSchema: { parse: (value: unknown) => unknown } = channels[name].response;
      this.tracker.count("handled");
      return responseSchema.parse(res);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.tracker.count("errors");
      return { ok: false, error: { code: "E_HANDLER", message: `${name}: ${message}` } };
    }
  }
}

export function createIpc(): ServiceStatus {
  return getIpcRouter().start();
}

let instance: IpcRouter | null = null;

export function getIpcRouter(): IpcRouter {
  instance ??= new IpcRouter({
    handle: (channel, listener) => {
      // Electron types the handler as (IpcMainInvokeEvent, ...args); the port
      // narrows the event to the sender frame fields the router reads.
      const electronListener = listener as (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
      ipcMain.handle(channel, electronListener);
    },
    removeHandler: (channel) => {
      ipcMain.removeHandler(channel);
    },
  });
  return instance;
}
