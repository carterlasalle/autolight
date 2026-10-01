// T-MAT-03: Matter identity binding (F-MAT-01).
//
// A commissioned Matter node becomes a Govee device record only through an
// explicit user confirmation after an identify flash. Vendor and product IDs
// come from the Basic Information cluster read, never from the pairing
// input. An existing binding is never overwritten silently: a different node
// for the same fixture needs allowRebind, which the UI sets only behind a
// second confirmation.

import { MatterError, type MatterAdapter } from "./controller.js";

export interface DeviceRecord {
  fixtureId: string;
  matterNodeId: number;
  vendorId: number;
  productId: number;
  multiAdmin: boolean;
  boundAtMs: number;
}

export interface BindRequest {
  fixtureId: string;
  nodeId: number;
  multiAdmin: boolean;
  allowRebind: boolean;
  confirmIdentify: () => Promise<boolean>;
}

export async function bindNode(
  adapter: MatterAdapter,
  store: Map<string, DeviceRecord>,
  req: BindRequest,
): Promise<DeviceRecord> {
  const vendorId = await adapter.read(req.nodeId, "basicInformation", "vendorId");
  const productId = await adapter.read(req.nodeId, "basicInformation", "productId");
  if (vendorId === null || productId === null) {
    throw new MatterError("unknown-node", `node ${req.nodeId} has no Basic Information cluster`);
  }
  await adapter.command(req.nodeId, "identify", "identify", { identifyTime: 5 });
  const confirmed = await req.confirmIdentify();
  if (!confirmed) throw new MatterError("not-confirmed", `fixture ${req.fixtureId} binding declined after identify flash`);
  const existing = store.get(req.fixtureId);
  if (existing !== undefined && existing.matterNodeId !== req.nodeId && !req.allowRebind) {
    throw new MatterError("already-bound", `fixture ${req.fixtureId} is bound to node ${existing.matterNodeId}`);
  }
  const record: DeviceRecord = {
    fixtureId: req.fixtureId,
    matterNodeId: req.nodeId,
    vendorId,
    productId,
    multiAdmin: req.multiAdmin,
    boundAtMs: Date.now(),
  };
  store.set(record.fixtureId, { ...record });
  return record;
}
