// T-MAT-01: Matter controller process contract (F-MAT-01).
//
// The production controller runs in an Electron utility process with its own
// storage directory and fabric credentials encrypted with safeStorage keys
// from main. That process is packaging work outside this slice; what this
// file owns is the contract it must implement, so the utility process, the
// simulator (simulator.ts) and the tests all speak to one interface.
//
// matter.js (`@matter/main`) is deliberately NOT a dependency yet. The
// interface below is the seam a matter.js-backed adapter will implement
// (commission on-network with a pairing code or QR payload, multi-admin
// codes from Apple Home, Google Home or SmartThings carried as provenance).
// Until then the in-memory adapter is the implementation every Matter probe
// drives in CI. No test claims radio behaviour.

export type ControllerState = "stopped" | "ready";

export type PairingKind = "manual-code" | "qr-payload";

export interface CommissionOptions {
  source: "manual" | "scan";
  provenance: "direct" | "multi-admin";
}

export interface CommissionedNode {
  nodeId: number;
  pairingKind: PairingKind;
  commissionedVia: "manual" | "scan";
  multiAdmin: boolean;
}

export interface MatterCommand {
  nodeId: number;
  cluster: string;
  command: string;
  payload: Record<string, number>;
}

export interface MatterAdapter {
  readonly storageDir: string;
  readonly state: ControllerState;
  commission(pairingCode: string, options: CommissionOptions): Promise<CommissionedNode>;
  command(nodeId: number, cluster: string, command: string, payload?: Record<string, number>): Promise<void>;
  read(nodeId: number, cluster: string, attribute: string): Promise<number | null>;
  close(): Promise<void>;
}

export type MatterReason = "bad-pairing-code" | "stopped" | "unknown-node" | "not-confirmed" | "already-bound";

export class MatterError extends Error {
  readonly reason: MatterReason;
  constructor(reason: MatterReason, detail: string) {
    super(`${reason}: ${detail}`);
    this.name = "MatterError";
    this.reason = reason;
  }
}

/** Classify a pairing input. Manual codes are 11 digits (spaces and dashes
 *  ignored); QR payloads start with MT:. Anything else is null, never a
 *  guess. Multi-admin is provenance declared by the caller, not a format. */
export function classifyPairingCode(code: string): PairingKind | null {
  const trimmed = code.trim();
  if (trimmed.length === 0) return null;
  if (/^MT:[A-Z0-9.+-]+$/i.test(trimmed)) return "qr-payload";
  if (/^\d{11}$/.test(trimmed.replace(/[ \-]/g, ""))) return "manual-code";
  return null;
}

export interface BasicInfo {
  vendorId: number;
  productId: number;
}

interface NodeRuntime extends BasicInfo {
  on: boolean;
  level: number;
  hue: number;
  saturation: number;
  multiAdmin: boolean;
}

/** In-memory Matter adapter (T-MAT-01). Holds commissioned nodes, records
 *  every command in order, and applies OnOff, LevelControl and ColorControl
 *  writes to per-node state so tests assert what a light would show. Fabric
 *  credentials are represented by storageDir only; the safeStorage wrapping
 *  lives in the Electron utility process, not here. */
export class InMemoryAdapter implements MatterAdapter {
  private readonly nodes = new Map<number, NodeRuntime>();
  private readonly recorded: MatterCommand[] = [];
  private nextNodeId = 1;
  private closed = false;

  constructor(
    readonly storageDir: string,
    private readonly identity: BasicInfo = { vendorId: 0xfff1, productId: 0x8001 },
  ) {}

  get state(): ControllerState {
    return this.closed ? "stopped" : "ready";
  }

  get commands(): readonly MatterCommand[] {
    return this.recorded;
  }

  async commission(pairingCode: string, options: CommissionOptions): Promise<CommissionedNode> {
    if (this.closed) throw new MatterError("stopped", "controller is closed");
    const pairingKind = classifyPairingCode(pairingCode);
    if (pairingKind === null) throw new MatterError("bad-pairing-code", `rejected ${JSON.stringify(pairingCode)}`);
    const nodeId = this.nextNodeId;
    this.nextNodeId += 1;
    const multiAdmin = options.provenance === "multi-admin";
    this.nodes.set(nodeId, {
      vendorId: this.identity.vendorId,
      productId: this.identity.productId,
      on: false, level: 0, hue: 0, saturation: 0, multiAdmin,
    });
    return { nodeId, pairingKind, commissionedVia: options.source, multiAdmin };
  }

  async command(nodeId: number, cluster: string, cmd: string, payload: Record<string, number> = {}): Promise<void> {
    if (this.closed) throw new MatterError("stopped", "controller is closed");
    const node = this.nodes.get(nodeId);
    if (node === undefined) throw new MatterError("unknown-node", `no node ${nodeId}`);
    this.recorded.push({ nodeId, cluster, command: cmd, payload: { ...payload } });
    if (cluster === "onOff" && cmd === "on") node.on = true;
    else if (cluster === "onOff" && cmd === "off") node.on = false;
    else if (cluster === "levelControl" && cmd === "moveToLevel" && typeof payload["level"] === "number") {
      node.level = payload["level"] as number;
    } else if (cluster === "colorControl" && cmd === "moveToHueAndSaturation") {
      if (typeof payload["hue"] === "number") node.hue = payload["hue"] as number;
      if (typeof payload["saturation"] === "number") node.saturation = payload["saturation"] as number;
    }
  }

  async read(nodeId: number, cluster: string, attribute: string): Promise<number | null> {
    if (this.closed) throw new MatterError("stopped", "controller is closed");
    const node = this.nodes.get(nodeId);
    if (node === undefined) throw new MatterError("unknown-node", `no node ${nodeId}`);
    if (cluster === "basicInformation" && attribute === "vendorId") return node.vendorId;
    if (cluster === "basicInformation" && attribute === "productId") return node.productId;
    return null;
  }

  nodeState(nodeId: number): { on: boolean; level: number; hue: number; saturation: number } | undefined {
    const node = this.nodes.get(nodeId);
    if (node === undefined) return undefined;
    return { on: node.on, level: node.level, hue: node.hue, saturation: node.saturation };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
