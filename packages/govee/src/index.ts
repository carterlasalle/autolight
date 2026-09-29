// LAN opcodes (§46); newest-state-wins coalescing (§51).
export const OPCODE = { ARM: 0xb1, RGB_STREAM: 0xb0, ZONED: 0xb4, ARM_STATUS: 0xb2 } as const;
export const PORTS = { DISCOVER_MCAST: 4001, DISCOVER_RESP: 4002, CONTROL: 4003 } as const;

// XOR checksum over length+opcode+payload (§46 frame family BB <len> <op> <payload> <xor>).
export function encodeFrame(opcode: number, payload: Uint8Array): Uint8Array {
  const len = 1 + payload.length + 1;
  const out = new Uint8Array(2 + len);
  out[0] = 0xbb; out[1] = len; out[2] = opcode;
  out.set(payload, 3);
  let xor = 0;
  for (let i = 1; i < out.length - 1; i++) xor ^= out[i]!;
  out[out.length - 1] = xor;
  return out;
}

// Newest-state-wins: keep only latest pending frame (§51, §149).
export class FrameCoalescer {
  private pending: Uint8Array | null = null;
  push(frame: Uint8Array): void { this.pending = frame; }
  take(): Uint8Array | null { const f = this.pending; this.pending = null; return f; }
}
