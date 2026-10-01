import { describe, expect, it } from "vitest";
import { bindNode, type DeviceRecord } from "./binding.js";
import { toMatterWrites } from "./mapping.js";
import { TEST_PAIRING_CODE, startVirtualLight } from "./simulator.js";

describe("virtual light", () => {
  it("uses the fixed test pairing code", () => {
    expect(TEST_PAIRING_CODE).toBe("1234-567-8901");
  });
  it("commissions on-network in CI and applies a red frame to readable state", async () => {
    const light = startVirtualLight();
    const node = await light.adapter.commission(light.pairingCode, { source: "manual", provenance: "direct" });
    for (const w of toMatterWrites({ r: 255, g: 0, b: 0 })) {
      await light.adapter.command(node.nodeId, w.cluster, w.command, w.payload);
    }
    expect(light.adapter.nodeState(node.nodeId)).toEqual({ on: true, level: 254, hue: 0, saturation: 254 });
    await light.adapter.close();
    expect(light.adapter.state).toBe("stopped");
  });
  it("runs the full binding flow end to end against the virtual light", async () => {
    const light = startVirtualLight();
    const node = await light.adapter.commission(light.pairingCode, { source: "manual", provenance: "direct" });
    const store = new Map<string, DeviceRecord>();
    const record = await bindNode(light.adapter, store, {
      fixtureId: "virtual-strip",
      nodeId: node.nodeId,
      multiAdmin: node.multiAdmin,
      allowRebind: false,
      confirmIdentify: async () => true,
    });
    expect(record.fixtureId).toBe("virtual-strip");
    expect(record.vendorId).toBe(0xfff1);
    await light.adapter.close();
  });
  it("rejects a wrong pairing code before any node exists", async () => {
    const light = startVirtualLight();
    await expect(light.adapter.commission("bogus", { source: "manual", provenance: "direct" }))
      .rejects.toMatchObject({ reason: "bad-pairing-code" });
    await light.adapter.close();
  });
});
