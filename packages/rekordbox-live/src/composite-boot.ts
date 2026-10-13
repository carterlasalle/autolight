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
// `provider.ingestAxPlayhead`, which the caller gates on fresh/readable AX;
// `CompositeFlx4Boot.fuseAx` additionally rejects out-of-order `atNs`
// samples so a late reading cannot step the playhead backwards.
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
  // Single live boot: retire any previous one before starting so its
  // listeners and hotplug polling cannot be orphaned by the overwrite.
  await stopCompositeFlx4Boot();

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

      return;
    }

    // Every non-connected state (searching, lost, unavailable-on-this-device,
    // failed) must reach the provider: a hotplug disconnect would otherwise
    // leave the stale estimate running as if the board were still live.
    provider.reportMidiUnavailable(status.reason ?? "no controller", status.remedy ?? "");
    log(FLX4_IDLE_MESSAGE);
  };

  const stopStatus = service.onStatusChange(announce);

  const dispose = async (): Promise<void> => {
    // Each teardown step is isolated: one failure must not skip the rest
    // (a half-stopped boot would keep polling unreachable).
    try {
      stopStatus();
    } catch { /* unsubscribe is best-effort; teardown continues */ }

    try {
      wiring.stop();
    } catch { /* unsubscribe is best-effort; teardown continues */ }

    try {
      await service.stop();
    } catch { /* device teardown is best-effort; provider still stops */ }

    try {
      await provider.stop();
    } catch { /* provider teardown is best-effort; caller sees no throw */ }
  };

  let status: Flx4ControllerStatus;

  try {
    status = await service.start();
    await provider.start();
  } catch (cause) {
    // A half-started pair has no boot handle yet: tear the fresh resources
    // down before rethrowing so nothing keeps polling unreachable.
    await dispose();

    throw cause;
  }

  announce(status);

  const lastAxAtNs = new Map<1 | 2, bigint>();

  const fuseAx = (deck: 1 | 2, axPlayheadSeconds: number | null, atNs: bigint): boolean => {
    // The provider rebases its anchor to the supplied atNs unconditionally,
    // so a late/out-of-order AX sample would step the playhead backwards.
    const lastAtNs = lastAxAtNs.get(deck);

    if (lastAtNs !== undefined && atNs < lastAtNs) return false;

    const fused = provider.ingestAxPlayhead(deck, axPlayheadSeconds, atNs);

    if (fused) lastAxAtNs.set(deck, atNs);

    return fused;
  };

  const boot: CompositeFlx4Boot = {
    provider,
    service,
    stop: async () => {
      try {
        await dispose();
      } finally {
        if (active === boot) active = null;
      }
    },
    fuseAx,
  };

  active = boot;

  return { boot, connected: status.connection === "connected", status };
}

export async function stopCompositeFlx4Boot(): Promise<void> {
  const boot = active;
  // Clear the singleton before awaiting: a rejected teardown must not leave
  // `active` pointing at a half-stopped boot.
  active = null;

  await boot?.stop();
}
