// Transport model and failover policy (T-FOV-01, closes F-GOV-18, spec 148).
//
// Replaces the misnamed `LanTransport = "lan" | "ble" | "cloud"` with the
// six-transport union the plan fixes: `lan-razer`, `lan-json`,
// `ble-segmented`, `ble-single`, `matter`, `cloud-metadata`. Each fixture
// carries an ordered list of enabled transports
// (govee.device.<fixtureId>.transportOrder) and a verified capability record
// per transport from qualification; the per-device mode
// (govee.device.<fixtureId>.transportMode, DS-31) picks the stance.
//
// Policy (govee.failover.policy, DS-03): `strict` pins the first enabled
// transport and never switches; `auto` uses the best verified transport at
// any moment; `hybrid` (default) routes segment frames only to verified
// segmented transports and allows whole-fixture fallback with a visible
// banner. Cloud never carries frames and never serves beat-critical use.
//
// An explicit single-transport mode is never overridden by the policy: that
// is the strict stance the toolkit takes (modes are explicit per device, no
// silent switching). A mode the fixture has not qualified for reports
// disabled with the reason, so the tile can show it.

export const TRANSPORTS = [
  "lan-razer",
  "lan-json",
  "ble-segmented",
  "ble-single",
  "matter",
  "cloud-metadata",
] as const;

export type TransportId = (typeof TRANSPORTS)[number];

export type FailoverPolicy = "strict" | "auto" | "hybrid";

export type DeviceTransportMode =
  | "auto"
  | "hybrid"
  | "lan-segmented"
  | "lan-basic"
  | "ble-segmented"
  | "ble-basic"
  | "matter-basic"
  | "cloud-basic";

export const DEVICE_MODES: readonly DeviceTransportMode[] = [
  "auto",
  "hybrid",
  "lan-segmented",
  "lan-basic",
  "ble-segmented",
  "ble-basic",
  "matter-basic",
  "cloud-basic",
];

/** Spec 148 order: LAN segmented, then BLE segmented if verified, then
 *  whole-fixture LAN. Mirrors govee.device.<fixtureId>.transportOrder. */
export const DEFAULT_TRANSPORT_ORDER: readonly TransportId[] = [
  "lan-razer",
  "ble-segmented",
  "lan-json",
  "ble-single",
  "matter",
];

export type FrameClass = "segments" | "whole" | "never";

/** What each transport can carry. Cloud metadata is never a frame path. */
export const FRAME_CLASS: Record<TransportId, FrameClass> = {
  "lan-razer": "segments",
  "ble-segmented": "segments",
  "lan-json": "whole",
  "ble-single": "whole",
  matter: "whole",
  "cloud-metadata": "never",
};

/** Explicit modes pin exactly one transport; the policy never overrides. */
export const MODE_PINNED: Record<Exclude<DeviceTransportMode, "auto" | "hybrid">, TransportId> = {
  "lan-segmented": "lan-razer",
  "lan-basic": "lan-json",
  "ble-segmented": "ble-segmented",
  "ble-basic": "ble-single",
  "matter-basic": "matter",
  "cloud-basic": "cloud-metadata",
};

export interface TransportStatus {
  verified: boolean;
  reachable: boolean;
}

export interface FixtureTransportConfig {
  fixtureId: string;
  mode: DeviceTransportMode;
  policy: FailoverPolicy;
  order: readonly TransportId[];
  status: Partial<Record<TransportId, TransportStatus>>;
  cloudAllowed: boolean;
  fromShowTick: boolean;
}

export interface Selection {
  transport: TransportId | null;
  frameClass: FrameClass | null;
  pinned: boolean;
  degraded: boolean;
  banner: string | null;
  reason: string;
}

function statusOf(cfg: FixtureTransportConfig, transport: TransportId): TransportStatus {
  return cfg.status[transport] ?? { verified: false, reachable: false };
}

function usable(cfg: FixtureTransportConfig, transport: TransportId): boolean {
  const s = statusOf(cfg, transport);
  return s.verified && s.reachable;
}

/** Whether the tile offers the mode or shows it disabled with the reason. */
export function modeAvailability(
  mode: DeviceTransportMode,
  status: Partial<Record<TransportId, TransportStatus>>,
): { enabled: boolean; reason: string } {
  if (mode === "auto" || mode === "hybrid") {
    const anyFrame = TRANSPORTS.some(
      (t) => FRAME_CLASS[t] !== "never" && (status[t]?.verified ?? false),
    );
    return anyFrame
      ? { enabled: true, reason: "Qualified frame transport present." }
      : { enabled: false, reason: "No frame transport qualified on this unit." };
  }
  const pinned = MODE_PINNED[mode];
  if (mode === "cloud-basic") {
    return {
      enabled: true,
      reason: "Cloud setup looks only; never frames, never during Live.",
    };
  }
  const s = status[pinned];
  if (s?.verified === true) return { enabled: true, reason: "Qualified on this unit." };
  const label = pinned === "ble-segmented" || pinned === "ble-single" ? "BLE" : pinned;
  return { enabled: false, reason: `${label} not qualified on this unit.` };
}

/** Cloud-basic guard: allowed only outside Live, only when the owner
 *  enabled cloud. The runtime invariant rejects any show-tick call. */
export function authorizeCloudBasic(opts: {
  fromShowTick: boolean;
  cloudAllowed: boolean;
}): { allowed: boolean; reason: string } {
  if (opts.fromShowTick) {
    return {
      allowed: false,
      reason: "Cloud call from the show tick is rejected: cloud never carries frames (spec 148).",
    };
  }
  if (!opts.cloudAllowed) {
    return {
      allowed: false,
      reason: "Cloud is disabled (security.cloudAllowed false).",
    };
  }
  return { allowed: true, reason: "Setup and idle looks only; never frames." };
}

/** Picks the transport that carries the next frame. Pure: the state machine
 *  and the tests drive it with the current reachability. */
export function selectFrameTransport(cfg: FixtureTransportConfig): Selection {
  const pinned = cfg.mode === "auto" || cfg.mode === "hybrid" ? null : MODE_PINNED[cfg.mode];
  if (pinned !== null) return selectPinned(cfg, pinned);
  if (cfg.policy === "strict") return selectStrict(cfg);
  if (cfg.policy === "auto") return selectAuto(cfg);
  return selectHybrid(cfg);
}

function selectPinned(cfg: FixtureTransportConfig, pinned: TransportId): Selection {
  if (pinned === "cloud-metadata") {
    const auth = authorizeCloudBasic({ fromShowTick: cfg.fromShowTick, cloudAllowed: cfg.cloudAllowed });
    return {
      transport: auth.allowed ? pinned : null,
      frameClass: auth.allowed ? "never" : null,
      pinned: true,
      degraded: true,
      banner: auth.allowed ? "Cloud setup look (never frames)" : null,
      reason: auth.reason,
    };
  }
  const s = statusOf(cfg, pinned);
  if (!s.verified) {
    const avail = modeAvailability(cfg.mode, cfg.status);
    return {
      transport: pinned,
      frameClass: FRAME_CLASS[pinned],
      pinned: true,
      degraded: true,
      banner: avail.reason,
      reason: `Pinned to ${pinned} without qualification; fixture holds instead of switching.`,
    };
  }
  if (!s.reachable) {
    return {
      transport: pinned,
      frameClass: FRAME_CLASS[pinned],
      pinned: true,
      degraded: true,
      banner: `${pinned} unreachable; explicit mode never switches.`,
      reason: `Pinned to ${pinned} which is down; fixture stays dark on this transport.`,
    };
  }
  return {
    transport: pinned,
    frameClass: FRAME_CLASS[pinned],
    pinned: true,
    degraded: FRAME_CLASS[pinned] === "whole",
    banner: FRAME_CLASS[pinned] === "whole" ? `Whole-fixture on ${pinned} (degraded)` : null,
    reason: `Explicit mode ${cfg.mode} pinned to ${pinned}.`,
  };
}

function selectStrict(cfg: FixtureTransportConfig): Selection {
  const first = cfg.order[0] ?? null;
  if (first === null || first === "cloud-metadata") {
    return {
      transport: null,
      frameClass: null,
      pinned: true,
      degraded: true,
      banner: "No frame transport enabled; fixture dark.",
      reason: "Strict policy with no usable first transport.",
    };
  }
  if (!usable(cfg, first)) {
    return {
      transport: first,
      frameClass: FRAME_CLASS[first],
      pinned: true,
      degraded: true,
      banner: `${first} unreachable; strict policy never switches.`,
      reason: `Strict policy holds ${first} while it is down.`,
    };
  }
  return {
    transport: first,
    frameClass: FRAME_CLASS[first],
    pinned: true,
    degraded: false,
    banner: null,
    reason: `Strict policy holds the first enabled transport ${first}.`,
  };
}

function firstUsable(cfg: FixtureTransportConfig, only: FrameClass | null): TransportId | null {
  for (const t of cfg.order) {
    if (t === "cloud-metadata") continue;
    if (only !== null && FRAME_CLASS[t] !== only) continue;
    if (usable(cfg, t)) return t;
  }
  return null;
}

function selectAuto(cfg: FixtureTransportConfig): Selection {
  const best = firstUsable(cfg, null);
  if (best === null) {
    return {
      transport: null,
      frameClass: null,
      pinned: false,
      degraded: true,
      banner: "All frame transports down; fixture dark.",
      reason: "Auto policy found no verified reachable frame transport.",
    };
  }
  const degraded = FRAME_CLASS[best] === "whole";
  return {
    transport: best,
    frameClass: FRAME_CLASS[best],
    pinned: false,
    degraded,
    banner: degraded ? `Whole-fixture on ${best} (degraded)` : null,
    reason: `Auto policy picked the best verified transport ${best}.`,
  };
}

function selectHybrid(cfg: FixtureTransportConfig): Selection {
  const segmented = firstUsable(cfg, "segments");
  if (segmented !== null) {
    const degraded = segmented !== "lan-razer";
    return {
      transport: segmented,
      frameClass: "segments",
      pinned: false,
      degraded,
      banner: degraded ? `Segmented on ${segmented} (fallback)` : null,
      reason: `Hybrid policy holds segment frames on ${segmented}.`,
    };
  }
  const whole = firstUsable(cfg, "whole");
  if (whole === null) {
    return {
      transport: null,
      frameClass: null,
      pinned: false,
      degraded: true,
      banner: "All frame transports down; fixture dark.",
      reason: "Hybrid policy found no verified reachable frame transport.",
    };
  }
  return {
    transport: whole,
    frameClass: "whole",
    pinned: false,
    degraded: true,
    banner: `Whole-fixture on ${whole} (degraded)`,
    reason: `Hybrid policy fell back to whole-fixture ${whole} with a banner.`,
  };
}

/** Test and SIM seam: routes one frame to the sink that owns the selected
 *  transport, so the test proves which transport carried the bytes. */
export interface FrameSink {
  transport: TransportId;
  send(frame: Uint8Array): void;
}

export function routeFrame(sel: Selection, frame: Uint8Array, sinks: FrameSink[]): TransportId {
  if (sel.transport === null) throw new Error(`No transport selected: ${sel.reason}`);
  const sink = sinks.find((s) => s.transport === sel.transport);
  if (sink === undefined) throw new Error(`No sink recorded transport ${sel.transport}`);
  sink.send(frame);
  return sink.transport;
}
