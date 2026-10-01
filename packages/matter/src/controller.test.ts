import { describe, expect, it } from "vitest";
import {
  InMemoryAdapter,
  MatterError,
  classifyPairingCode,
} from "./controller.js";

describe("classifyPairingCode", () => {
  it("accepts an 11 digit manual code with dashes and spaces", () => {
    expect(classifyPairingCode("1234-567-8901")).toBe("manual-code");
    expect(classifyPairingCode("1234 567 8901")).toBe("manual-code");
    expect(classifyPairingCode("12345678901")).toBe("manual-code");
  });
  it("accepts an MT: qr payload", () => {
    expect(classifyPairingCode("MT:Y.K9042C00KA0648G00")).toBe("qr-payload");
  });
  it("rejects junk, short codes and empty input", () => {
    expect(classifyPairingCode("")).toBeNull();
    expect(classifyPairingCode("hello")).toBeNull();
    expect(classifyPairingCode("12345")).toBeNull();
    expect(classifyPairingCode("MT:")).toBeNull();
  });
});

describe("InMemoryAdapter commission", () => {
  it("commissions a manual code as a direct node", async () => {
    const adapter = new InMemoryAdapter("store-a");
    const node = await adapter.commission("1234-567-8901", { source: "manual", provenance: "direct" });
    expect(node.nodeId).toBe(1);
    expect(node.pairingKind).toBe("manual-code");
    expect(node.multiAdmin).toBe(false);
    expect(adapter.state).toBe("ready");
    await adapter.close();
  });
  it("commissions a qr payload from scan with multi-admin provenance", async () => {
    const adapter = new InMemoryAdapter("store-b");
    const node = await adapter.commission("MT:Y.K9042C00KA0648G00", { source: "scan", provenance: "multi-admin" });
    expect(node.pairingKind).toBe("qr-payload");
    expect(node.commissionedVia).toBe("scan");
    expect(node.multiAdmin).toBe(true);
    await adapter.close();
  });
  it("rejects a bad pairing code with a typed error", async () => {
    const adapter = new InMemoryAdapter("store-c");
    await expect(adapter.commission("nope", { source: "manual", provenance: "direct" }))
      .rejects.toMatchObject({ name: "MatterError", reason: "bad-pairing-code" });
    await adapter.close();
  });
  it("refuses work after close", async () => {
    const adapter = new InMemoryAdapter("store-d");
    await adapter.close();
    expect(adapter.state).toBe("stopped");
    await expect(adapter.commission("1234-567-8901", { source: "manual", provenance: "direct" }))
      .rejects.toMatchObject({ reason: "stopped" });
  });
});

describe("InMemoryAdapter command and read", () => {
  it("applies on, level and color writes to node state in order", async () => {
    const adapter = new InMemoryAdapter("store-e");
    const { nodeId } = await adapter.commission("1234-567-8901", { source: "manual", provenance: "direct" });
    await adapter.command(nodeId, "onOff", "on");
    await adapter.command(nodeId, "levelControl", "moveToLevel", { level: 200, transitionDs: 0 });
    await adapter.command(nodeId, "colorControl", "moveToHueAndSaturation", { hue: 10, saturation: 250, transitionDs: 0 });
    expect(adapter.nodeState(nodeId)).toEqual({ on: true, level: 200, hue: 10, saturation: 250 });
    expect(adapter.commands.map((c) => `${c.cluster}/${c.command}`)).toEqual([
      "onOff/on",
      "levelControl/moveToLevel",
      "colorControl/moveToHueAndSaturation",
    ]);
    await adapter.close();
  });
  it("reads vendor and product ids from Basic Information", async () => {
    const adapter = new InMemoryAdapter("store-f", { vendorId: 0x1234, productId: 0x5678 });
    const { nodeId } = await adapter.commission("MT:Y.K9042C00KA0648G00", { source: "scan", provenance: "direct" });
    expect(await adapter.read(nodeId, "basicInformation", "vendorId")).toBe(0x1234);
    expect(await adapter.read(nodeId, "basicInformation", "productId")).toBe(0x5678);
    await adapter.close();
  });
  it("throws unknown-node for a node that was never commissioned", async () => {
    const adapter = new InMemoryAdapter("store-g");
    await expect(adapter.command(99, "onOff", "on")).rejects.toMatchObject({ reason: "unknown-node" });
    await expect(adapter.read(99, "basicInformation", "vendorId")).rejects.toMatchObject({ reason: "unknown-node" });
    try {
      await adapter.command(99, "onOff", "on");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(MatterError);
    }
    await adapter.close();
  });
});
