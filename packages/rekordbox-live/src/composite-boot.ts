// Plug-and-play host for the composite FLX4 provider (F-LIVE-06 MIDI part).
//
// Wiring (all four layers already exist; this file owns the seam):
// - `Flx4ControllerService` (T-FLX-01 backend) opens the board
//   non-exclusively by port name and hotplug-polls for plug/unplug.
// - `Flx4StateModel` + `Flx4SignalDeriver` (T-FLX-03/04) own controller state.
// - `subscribeServiceToComposite` (T-FLX-06 integration) drains MIDI
//   transport hints (PLAY/CUE/jog/tempo/faders per the T-FLX-02 map) into the
//   `CompositeProvider` (T-LIVE-07 composite).
//
// Telemetry is secondary truth (spec 11): MIDI confirms transport and faders
// but never overrides a stronger playhead. AX fusion goes through
// `provider.ingestAxPlayhead`, which the caller gates on fresh/readable AX.
//
// Board absent is the steady state, not an error: `startCompositeFlx4Boot`
// logs `FLX4 not present, composite idle` and returns `connected: false`
// instead of throwing, so boot proceeds to AX/prolink unchanged. Board
// appearance is picked up by the service hotplug poll with zero changes.
//
// macOS device name: the board enumerates as `DDJ-FLX4` (CoreMIDI port
// `DDJ-FLX4 MIDI 1`); `portMatch` defaults to the `DDJ-FLX4` substring.
import {
  Flx4ControllerService,
  Flx4SignalDeriver,
  Flx4StateModel,
  subscribeServiceToComposite,
  type Flx4BackendName,
  type Flx4ControllerStatus,
  type Flx4Event,
  type Flx4ServiceOptions,
} from "@autolight/controller-flx4";
import { CompositeProvider, type CompositeProviderOptions } from "./composite.js";

export const FLX4_MACOS_DEVICE_NAME = "DDJ-FLX4";
export const FLX4_MACOS_PORT_NAME = "DDJ-FLX4 MIDI 1";
export const FLX4_IDLE_MESSAGE = "FLX4 not present, composite idle";

export interface CompositeFlx4BootServiceOpts {
  mode?: "auto" | Flx4BackendName;
  portMatch?: string;
  hotplugPollMs?: number;
}

export interface CompositeFlx4BootOptions {
  portMatch?: string;
  mode?: "auto" | Flx4BackendName;
  hotplugPollMs?: number;
  composite?: CompositeProviderOptions;
  log?: (message: string) => void;
  createComposite?: (opts: CompositeProviderOptions) => CompositeProvider;
  createService?: (serviceOpts: CompositeFlx4BootServiceOpts) => Flx4ControllerService;
}

export interface CompositeFlx4Boot {
  provider: CompositeProvider;
  service: Flx4ControllerService;
  stop: () => Promise<void>;
  fuseAx: (deck: 1 | 2, axPlayheadSeconds: number | null, atNs: bigint) => boolean;
}

let active: CompositeFlx4Boot | null = null;

export function activeCompositeFlx4Boot(): CompositeFlx4Boot | null {
  return active;
}

function serviceOptionsFor(opts: CompositeFlx4BootOptions, portMatch: string): Flx4ServiceOptions {
  const out: Flx4ServiceOptions = { portMatch };
  if (opts.mode !== undefined) out.mode = opts.mode;
  if (opts.hotplugPollMs !== undefined) out.hotplugPollMs = opts.hotplugPollMs;
  return out;
}

export async function startCompositeFlx4Boot(
  opts: CompositeFlx4BootOptions = {},
): Promise<{ boot: CompositeFlx4Boot; connected: boolean; status: Flx4ControllerStatus }> {
  const log = opts.log ?? console.info.bind(console, "[composite-flx4]");
  const portMatch = opts.portMatch ?? FLX4_MACOS_DEVICE_NAME;
  const provider =
    opts.createComposite === undefined
      ? new CompositeProvider(opts.composite ?? {})
      : opts.createComposite(opts.composite ?? {});
  const service =
    opts.createService === undefined
      ? new Flx4ControllerService(serviceOptionsFor(opts, portMatch))
      : opts.createService(serviceOptionsFor(opts, portMatch));
  const model = new Flx4StateModel();
  const deriver = new Flx4SignalDeriver({ djSoftware: "rekordbox" });
  // The deriver needs the post-apply snapshot; the wiring only forwards the
  // derived signals, so adapt the two-arg shape at the boundary.
  const wiring = subscribeServiceToComposite(
    service,
    model,
    (event: Flx4Event) => deriver.derive(event, model.snapshot()),
    provider,
  );
  const announce = (status: Flx4ControllerStatus): void => {
    if (status.connection === "connected") {
      provider.reportMidiAvailable();
      log(`connected on ${status.portName ?? FLX4_MACOS_PORT_NAME}`);
    } else if (status.connection === "searching") {
      provider.reportMidiUnavailable(status.reason ?? "no controller", status.remedy ?? "");
      log(FLX4_IDLE_MESSAGE);
    }
  };
  const stopStatus = service.onStatusChange(announce);
  const status = await service.start();
  await provider.start();
  announce(status);
  const boot: CompositeFlx4Boot = {
    provider,
    service,
    stop: async () => {
      stopStatus();
      wiring.stop();
      await service.stop();
      await provider.stop();
      if (active === boot) active = null;
    },
    fuseAx: (deck, axPlayheadSeconds, atNs) => provider.ingestAxPlayhead(deck, axPlayheadSeconds, atNs),
  };
  active = boot;
  return { boot, connected: status.connection === "connected", status };
}

export async function stopCompositeFlx4Boot(): Promise<void> {
  await active?.stop();
  active = null;
}
