// T-MAT-04: Matter simulator (F-MAT-01, F-QA-12 Matter).
//
// A virtual colour light: an InMemoryAdapter node commissioned on-network in
// tests with a fixed pairing code. The virtual light applies OnOff,
// LevelControl and ColorControl writes to readable state, so commission plus
// control tests observe what the light shows. No radio, no hardware claim.

import { InMemoryAdapter } from "./controller.js";

/** Fixed test pairing code. Every CI run commissions with this value. */
export const TEST_PAIRING_CODE = "1234-567-8901";

export interface VirtualLight {
  pairingCode: string;
  adapter: InMemoryAdapter;
}

export function startVirtualLight(pairingCode: string = TEST_PAIRING_CODE): VirtualLight {
  return { pairingCode, adapter: new InMemoryAdapter("matter-sim-storage") };
}
