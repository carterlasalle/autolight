import { describe, expect, it } from "vitest";
import { bindNode, type DeviceRecord } from "./binding.js";
import { InMemoryAdapter } from "./controller.js";

async function commissioned() {
  const adapter = new InMemoryAdapter("bind-store", { vendorId: 0x1234, productId: 0x5678 });
  const node = await adapter.commission("1234-567-8901", { source: "manual", provenance: "direct" });
  return { adapter, nodeId: node.nodeId };
}

describe("bindNode", () => {
  it("records vendor and product ids from Basic Information after an identify flash and confirmation", async () => {
    const { adapter, nodeId } = await commissioned();
    const store = new Map<string, DeviceRecord>();
    let flashed = 0;
    const record = await bindNode(adapter, store, {
      fixtureId: "strip-1",
      nodeId,
      multiAdmin: false,
      allowRebind: false,
      confirmIdentify: async () => { flashed += 1; return true; },
    });
    expect(record).toMatchObject({ fixtureId: "strip-1", matterNodeId: nodeId, vendorId: 0x1234, productId: 0x5678 });
    expect(flashed).toBe(1);
    expect(adapter.commands.map((c) => `${c.cluster}/${c.command}`)).toContain("identify/identify");
    expect(store.get("strip-1")).toEqual(record);
    await adapter.close();
  });
  it("saves nothing when the user declines after the flash", async () => {
    const { adapter, nodeId } = await commissioned();
    const store = new Map<string, DeviceRecord>();
    await expect(bindNode(adapter, store, {
      fixtureId: "strip-2",
      nodeId,
      multiAdmin: false,
      allowRebind: false,
      confirmIdentify: async () => false,
    })).rejects.toMatchObject({ reason: "not-confirmed" });
    expect(store.get("strip-2")).toBeUndefined();
    await adapter.close();
  });
  it("refuses to overwrite an existing binding without allowRebind", async () => {
    const adapter = new InMemoryAdapter("rebind-store");
    const first = await adapter.commission("1234-567-8901", { source: "manual", provenance: "direct" });
    const second = await adapter.commission("MT:Y.K9042C00KA0648G00", { source: "scan", provenance: "multi-admin" });
    const store = new Map<string, DeviceRecord>();
    const yes = async () => true;
    await bindNode(adapter, store, { fixtureId: "strip-3", nodeId: first.nodeId, multiAdmin: false, allowRebind: false, confirmIdentify: yes });
    await expect(bindNode(adapter, store, { fixtureId: "strip-3", nodeId: second.nodeId, multiAdmin: true, allowRebind: false, confirmIdentify: yes }))
      .rejects.toMatchObject({ reason: "already-bound" });
    expect(store.get("strip-3")?.matterNodeId).toBe(first.nodeId);
    const rebound = await bindNode(adapter, store, { fixtureId: "strip-3", nodeId: second.nodeId, multiAdmin: true, allowRebind: true, confirmIdentify: yes });
    expect(rebound.matterNodeId).toBe(second.nodeId);
    expect(rebound.multiAdmin).toBe(true);
    await adapter.close();
  });
  it("rejects a node that was never commissioned", async () => {
    const adapter = new InMemoryAdapter("ghost-store");
    const store = new Map<string, DeviceRecord>();
    await expect(bindNode(adapter, store, {
      fixtureId: "strip-4",
      nodeId: 4242,
      multiAdmin: false,
      allowRebind: false,
      confirmIdentify: async () => true,
    })).rejects.toMatchObject({ reason: "unknown-node" });
    await adapter.close();
  });
});
