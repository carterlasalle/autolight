import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { channels, type Channel, type ChannelRequest, type ChannelResponse } from "@autolight/ipc";
import {
  scanLanCommand, identifyCommand, testChaseCommand,
  listAudioDevices, readAudioLevel,
  readDiagnostics, readLiveShow, setSimulatorMode, setFollowMode,
  setShowStyle, setEnergyTier, triggerBuild, triggerDrop,
  setMasterBlackout, setMasterFull, setMasterFreeze, setMasterIntensity, resumeMaster,
  readShowState, readVenueList, setVenueColor, deviceAction, pollAxCommand,
  renameVenueDevice, setVenueDeviceEnabled, setVenueSegments, setVenueAlternate, setVenueAlternateBpm, setVenuePower, paintStripesCommand, paintRangeCommand,
} from "./../show-service.js";
import { ServiceTracker, type Service, type ServiceStatus } from "./base.js";
import { getConfigService } from "./config-service.js";
import { audit } from "./audit-log.js";
// ipc-router (T-ARC-02, spec 87; moved here from electron/ipc.ts by T-ARC-05):
// typed channels only, sender checked, request and response validated. Main
// registers it before the window is created. Errors return typed
// { ok: false, error } and surface in UI status, never swallowed.

// Trusted renderer origin (Vite dev server). Compared as an exact parsed
// origin, never a string prefix: `http://localhost:5173@evil.com` and
// `http://localhost:5173.evil.com` must not match. Single constant so the
// ipc-router, navigation guard and permission checks cannot drift.
export const TRUSTED_DEV_ORIGIN = "http://localhost:5173";

export interface IpcEventLike {
  senderFrame?: { url?: string } | null;
}
// The router talks to this port instead of ipcMain so the whole channel table
// is testable without an Electron process.

/**
 * Structured-clone value exactly as Electron delivers it. The router parses
 * it against the channel's request schema before any handler runs — this is
 * the raw side of the I/O boundary.
 */
export type RawIpcValue = string | number | boolean | null | undefined | RawIpcValue[] | { [key: string]: RawIpcValue };

/** Everything the router can reply: a channel's validated response or the
 * typed error envelope. */
export type IpcReply =
  | { [C in Channel]: ChannelResponse<C> }[Channel]
  | { ok: false; error: { code: string; message: string } };

/** Listener shape the port stores per channel; exported so test mocks bind
 * the same contract instead of re-declaring unknown-typed variants. */
export type IpcPortListener = (event: IpcEventLike, payload: RawIpcValue) => Promise<IpcReply>;

export interface IpcMainPort {
  handle(channel: string, listener: IpcPortListener): void;
  removeHandler(channel: string): void;
}

// SAFETY: channels is the exhaustive Channel-keyed table, so its own keys
// are exactly the Channel union.
const channelNames = Object.keys(channels) as Channel[];

type ChannelHandler<C extends Channel> = (
  request: ChannelRequest<C>,
) => Promise<ChannelResponse<C>> | ChannelResponse<C>;

/** The full channel table: one handler per channel, correlated via the
 * mapped type so every handler's request/response types come from its own
 * channel entry. */
type ChannelHandlerTable = { [C in Channel]: ChannelHandler<C> };

const handlers: ChannelHandlerTable = {
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
  "venue/set-color": (req) => setVenueColor(req.rgb, req.targets),
  "venue/segments-set": (req) => setVenueSegments(req.id, req.zones),
  "venue/alternate": (req) => setVenueAlternate(req),
  "venue/alternate-bpm": (req) => setVenueAlternateBpm(req),
  "venue/power": (req) => setVenuePower(req.on, req.id),
  "venue/paint-stripes": (req) => paintStripesCommand(req.id, req.zones),
  "venue/paint-range": (req) => paintRangeCommand(req.id, req.from, req.to, req.rgb),
  "venue/device-action": (req) => deviceAction(req.id, req.action),
  "venue/device-rename": (req) => renameVenueDevice(req.id, req.name),
  "venue/device-enabled": (req) => setVenueDeviceEnabled(req.id, req.enabled),
  "venue/scan": () => scanLanCommand(),
  "venue/identify": (req) => identifyCommand(req.id),
  "venue/test-chase": (req) => testChaseCommand(req.id),
  // AX polls through show-service authority: one poll feeds svc.ax (bridge)
  // and the response (renderer cursor). No second provider-manager cache.
  "follow/ax": async () => pollAxCommand(),
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

// Payload keys, never blobs: enough to identify the button pressed without
// flooding the file. Full payloads log on error paths only.
function summarizeReq(req: ChannelRequest<Channel>): string {
  const keys = Object.keys(req).filter((k) => k !== "version");

  return keys.length === 0 ? "{}" : `{${keys.join(",")}}`;
}

export class IpcRouter implements Service {
  readonly name = "ipc-router";
  private readonly tracker = new ServiceTracker("ipc-router");
  private registered = false;

  constructor(private readonly port: IpcMainPort) {}

  start(): ServiceStatus {
    if (!this.registered) {
      for (const name of channelNames) {
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
      for (const name of channelNames) this.port.removeHandler(name);
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
      const raw = event.senderFrame?.url;

      // Fail closed: an unknown sending frame must not be trusted.
      if (!raw) return false;
      const url = new URL(raw);

      // Exact origin/protocol check, never a prefix match.
      return url.protocol === "file:" || url.origin === TRUSTED_DEV_ORIGIN;
    } catch {
      return false;
    }
  }

  // Hot poll channels log errors only (250ms cadence would flood the file);
  // every other channel logs one line per call with its result. This is the
  // button→response trail: the renderer sends every action through invoke,
  // so channel + payload + ok/error lands here.
  private static readonly HOT: ReadonlySet<string> = new Set(["follow/ax", "show/live", "show/state"]);

  private async dispatch(name: Channel, event: IpcEventLike, raw: RawIpcValue): Promise<IpcReply> {
    const t0 = Date.now();

    if (!this.senderAllowed(event)) {
      this.tracker.count("denied");
      audit("ipc.denied", { channel: name });

      return { ok: false, error: { code: "E_SENDER", message: `sender not allowed for ${name}` } };
    }

    let req: ChannelRequest<Channel>;

    try {
      req = channels[name].request.parse(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.tracker.count("errors");
      audit("ipc.error", { channel: name, ms: Date.now() - t0, error: message.slice(0, 500) });

      return { ok: false, error: { code: "E_REQUEST", message: `${name}: ${message}` } };
    }

    // SAFETY: the handler table is invariant in its channel parameter; the
    // request was just validated against channels[name].request for this
    // same channel, so the runtime pairing is exact even though TS cannot
    // call a mapped-type member through this index.
    const runHandler = handlers[name] as ChannelHandler<Channel>;
    let res: ChannelResponse<Channel>;

    try {
      res = await runHandler(req);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.tracker.count("errors");
      audit("ipc.error", { channel: name, ms: Date.now() - t0, error: message.slice(0, 500) });

      return { ok: false, error: { code: "E_HANDLER", message: `${name}: ${message}` } };
    }

    try {
      // SAFETY: channels[name].response is this channel's response schema;
      // TS cannot invoke .parse across the union of channel schemas.
      const parseResponse = channels[name].response.parse as (value: ChannelResponse<Channel>) => IpcReply;
      const out = parseResponse(res);
      this.tracker.count("handled");
      const ms = Date.now() - t0;
      const ok = out.ok !== false;

      if (IpcRouter.HOT.has(name)) {
        if (!ok) audit("ipc.error", { channel: name, ms, error: JSON.stringify(out).slice(0, 500) });
      } else {
        audit("ipc", { channel: name, ms, ok, req: summarizeReq(req) });
      }

      return out;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.tracker.count("errors");
      audit("ipc.error", { channel: name, ms: Date.now() - t0, error: message.slice(0, 500) });

      return { ok: false, error: { code: "E_RESPONSE", message: `${name}: ${message}` } };
    }
  }
}

export function createIpc(): ServiceStatus {
  return getIpcRouter().start();
}

let instance: IpcRouter | null = null;

function getIpcRouter(): IpcRouter {
  instance ??= new IpcRouter({
    handle: (channel, listener) => {
      // SAFETY: Electron invokes the handler with (IpcMainInvokeEvent, ...args);
      // the port's contract narrows the event to the sender-frame fields the
      // router reads, and the payload/reply cross the same structured-clone
      // boundary the port types model. The adapter only rebrands the listener.
      const electronListener = listener as (event: IpcMainInvokeEvent, payload: RawIpcValue) => Promise<IpcReply>;
      ipcMain.handle(channel, electronListener);
    },
    removeHandler: (channel) => {
      ipcMain.removeHandler(channel);
    },
  });

  return instance;
}
