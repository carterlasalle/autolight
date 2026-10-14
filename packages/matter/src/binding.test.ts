import { afterEach, describe, expect, it } from "vitest";
import { bindNode, type DeviceRecord } from "./binding.js";
import { InMemoryAdapter } from "./controller.js";

// Every adapter the tests open lands here and is closed even when an
// assertion throws: cleanup must not depend on reaching the last line.
const opened: InMemoryAdapter[] = [];

afterEach(async () => {
  while (opened.length > 0) await opened.pop()!.close();
});

async function commissioned(name = "bind-store") {
  const adapter = new InMemoryAdapter(name, { vendorId: 0x1234, productId: 0x5678 });

  opened.push(adapter);
  const node = await adapter.commission("1234-567-8901", { source: "manual", provenance: "direct" });

  return { adapter, nodeId: node.nodeId };
}

describe("bindNode", () => {
  it("records vendor and product ids from Basic Information after an identify flash and confirmation", async () => {
    const { adapter, nodeId } = await commissioned();
    const store = new Map<string, DeviceRecord>();
    let flashed = 0;
    let commandsAtConfirm = -1;

    const record = await bindNode(adapter, store, {
      fixtureId: "strip-1",
      nodeId,
      multiAdmin: false,
      allowRebind: false,
      confirmIdentify: async () => {
        flashed += 1;
        // Snapshot where the command log stands when the user confirms.
        commandsAtConfirm = adapter.commands.length;

        return true;
      },
    });

    expect(record).toMatchObject({ fixtureId: "strip-1", matterNodeId: nodeId, vendorId: 0x1234, productId: 0x5678 });
    expect(flashed).toBe(1);
    // The documented flow: exactly one identify command, issued BEFORE the
    // confirmation prompt, and only then the record read and stored.
    const identifyIdx = adapter.commands.findIndex((c) => `${c.cluster}/${c.command}` === "identify/identify");

    expect(identifyIdx).toBeGreaterThanOrEqual(0);
    expect(adapter.commands.filter((c) => `${c.cluster}/${c.command}` === "identify/identify")).toHaveLength(1);
    expect(identifyIdx).toBeLessThan(commandsAtConfirm);
    expect(store.get("strip-1")).toEqual(record);
  });
  it("saves nothing when the user declines after the flash", async () => {
    const { adapter, nodeId } = await commissioned();
    const store = new Map<string, DeviceRecord>();
    let flashed = 0;

    await expect(bindNode(adapter, store, {
      fixtureId: "strip-2",
      nodeId,
      multiAdmin: false,
      allowRebind: false,
      confirmIdentify: async () => {
        flashed += 1;

        return false;
      },
    })).rejects.toMatchObject({ reason: "not-confirmed" });
    // The flash really happened before the decline, and the store is clean.
    expect(flashed).toBe(1);
    expect(adapter.commands.map((c) => `${c.cluster}/${c.command}`)).toContain("identify/identify");
    expect(store.get("strip-2")).toBeUndefined();
  });
  it("refuses to overwrite an existing binding without allowRebind", async () => {
    const { adapter, nodeId: firstId } = await commissioned("rebind-store");
    const second = await adapter.commission("MT:Y.K9042C00KA0648G00", { source: "scan", provenance: "multi-admin" });
    const store = new Map<string, DeviceRecord>();
    const yes = async () => true;

    await bindNode(adapter, store, { fixtureId: "strip-3", nodeId: firstId, multiAdmin: false, allowRebind: false, confirmIdentify: yes });
    const before = store.get("strip-3");

    await expect(bindNode(adapter, store, { fixtureId: "strip-3", nodeId: second.nodeId, multiAdmin: true, allowRebind: false, confirmIdentify: yes }))
      .rejects.toMatchObject({ reason: "already-bound" });
    // The rejected rebind leaves the WHOLE stored record untouched, not just
    // its node id.
    expect(store.get("strip-3")).toEqual(before);
    const rebound = await bindNode(adapter, store, { fixtureId: "strip-3", nodeId: second.nodeId, multiAdmin: true, allowRebind: true, confirmIdentify: yes });

    expect(rebound.matterNodeId).toBe(second.nodeId);
    expect(rebound.multiAdmin).toBe(true);
  });
  it("rejects a node that was never commissioned", async () => {
    const adapter = new InMemoryAdapter("ghost-store");

    opened.push(adapter);
    const store = new Map<string, DeviceRecord>();

    await expect(bindNode(adapter, store, {
      fixtureId: "strip-4",
      nodeId: 4242,
      multiAdmin: false,
      allowRebind: false,
      confirmIdentify: async () => true,
    })).rejects.toMatchObject({ reason: "unknown-node" });
  });
});
