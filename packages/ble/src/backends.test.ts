// T-BLE-01: backends and placement. Both backends connect to the sim; the
// DS-04 switch picks toolkit when it loads and scans, else noble, with a
// per-device override when one backend fails a device. Placement proves the
// host (worker thread, utility process or main) with a measured capability.
import { describe, expect, it } from "vitest";
import {
  BackendSelector,
  BleBackendLoadFailure,
  BleBackendUnavailableError,
  LatestWinsChannel,
  createBackendSelector,
  placeBleBackend,
  type BleAdapter,
  type BleConnection,
} from "./backends.js";
import { parseBleAdvertisement, type BleAdvertisement } from "./scan.js";

function ad(address: string): BleAdvertisement {
  return parseBleAdvertisement({ address, name: "GBK_H6076_AB12", manufacturer: new Uint8Array([0, 1, 2]) });
}

class FakeConnection implements BleConnection {
  readonly writes: Uint8Array[] = [];
  constructor(readonly address: string, readonly kind: "toolkit-ble" | "noble") {}
  subscribe(_handler: (notify: Uint8Array) => void): void {}
  async write(frame: Uint8Array): Promise<void> { this.writes.push(frame); }
  async disconnect(): Promise<void> {}
}

class FakeAdapter implements BleAdapter {
  readonly seen: string[] = [];
  constructor(
    readonly kind: "toolkit-ble" | "noble",
    private readonly opts: { scanFails?: boolean; failFor?: string[] } = {},
  ) {}
  async scan(timeoutMs: number): Promise<BleAdvertisement[]> {
    void timeoutMs;
    if (this.opts.scanFails === true) throw new Error(`fake ${this.kind} scan failed`);
    return [ad("AA:BB:CC:DD:EE:01")];
  }
  async connect(address: string): Promise<BleConnection> {
    this.seen.push(address);
    if ((this.opts.failFor ?? []).includes(address)) throw new Error(`fake ${this.kind} refused ${address}`);
    return new FakeConnection(address, this.kind);
  }
  async close(): Promise<void> {}
}

describe("ble backends (T-BLE-01)", () => {
  it("auto uses toolkit-ble when it loads", async () => {
    const selector = await createBackendSelector({
      mode: "auto",
      toolkit: new FakeAdapter("toolkit-ble"),
      noble: new FakeAdapter("noble"),
    });
    expect(selector.currentKind()).toBe("toolkit-ble");
    const connection = await selector.connect("AA:BB:CC:DD:EE:01");
    expect(connection.kind).toBe("toolkit-ble");
    expect(selector.decision("AA:BB:CC:DD:EE:01").reason).toBeNull();
  });

  it("auto falls back to noble with the typed load reason", async () => {
    const selector = await createBackendSelector({
      mode: "auto",
      loadToolkit: async () => { throw new BleBackendUnavailableError("load", "dlopen ble addon: image not found"); },
      noble: new FakeAdapter("noble"),
    });
    expect(selector.currentKind()).toBe("noble");
    expect(selector.summary().reason).toContain("dlopen ble addon");
    expect(selector.report().reason).toContain("ble backend failed to load");
  });

  it("toolkit mode throws instead of downgrading silently", async () => {
    const pending = createBackendSelector({
      mode: "toolkit-ble",
      loadToolkit: async () => { throw new Error("no artifact for darwin-x64"); },
    });
    await expect(pending).rejects.toBeInstanceOf(BleBackendLoadFailure);
    await expect(pending).rejects.toThrow(/no artifact for darwin-x64/);
  });

  it("falls back per device when its toolkit connection fails", async () => {
    const toolkit = new FakeAdapter("toolkit-ble", { failFor: ["BAD:01"] });
    const selector = await createBackendSelector({ mode: "auto", toolkit, noble: new FakeAdapter("noble") });
    const connection = await selector.connect("BAD:01");
    expect(connection.kind).toBe("noble");
    expect(selector.decision("BAD:01").reason).toContain("refused BAD:01");
    const healthy = await selector.connect("GOOD:01");
    expect(healthy.kind).toBe("toolkit-ble");
    expect(selector.decision("GOOD:01")).toEqual({ kind: "toolkit-ble", reason: null });
  });

  it("places the link manager by measured capability, bridging only on main", () => {
    expect(placeBleBackend("noble", { workerBleOk: true, utilityBleOk: false }).host).toBe("worker-thread");
    expect(placeBleBackend("noble", { workerBleOk: true, utilityBleOk: false }).bridged).toBe(false);
    expect(placeBleBackend("noble", { workerBleOk: false, utilityBleOk: true }).host).toBe("utility-process");
    const main = placeBleBackend("toolkit-ble", { workerBleOk: false, utilityBleOk: false });
    expect(main.host).toBe("main");
    expect(main.bridged).toBe(true);
    expect(main.reason).toContain("toolkit-ble");
  });

  it("the latest-wins bridge never queues: bursts replace, depth stays one", () => {
    const channel = new LatestWinsChannel();
    channel.send(new Uint8Array([1]));
    channel.send(new Uint8Array([2]));
    channel.send(new Uint8Array([3]));
    expect(channel.depth).toBe(1);
    expect(channel.dropped).toBe(2);
    expect([...(channel.take() ?? [])]).toEqual([3]);
    expect(channel.depth).toBe(0);
  });

  it("a scan failure retries once on the other backend", async () => {
    const selector = new BackendSelector({
      mode: "auto",
      primary: new FakeAdapter("toolkit-ble", { scanFails: true }),
      primaryKind: "toolkit-ble",
      primaryReason: null,
      secondary: new FakeAdapter("noble"),
    });
    const found = await selector.scan(100);
    expect(found).toHaveLength(1);
    expect(selector.summary().reason).toContain("fake toolkit-ble scan failed");
  });
});
