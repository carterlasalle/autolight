import { createSocket } from "node:dgram";
import {
  MULTICAST, SCAN_REQUEST, parseScanReply, parseDevStatus,
  turnCommand, brightnessCommand, colorCommand, devStatusCommand,
  collapseToSingleColor,
  type ScanReply,
} from "@autolight/govee";

// Official Govee LAN transport (main process owns UDP, §149):
// multicast scan → 239.255.255.250:4001, replies on 4002, unicast control
// to device IP:4003. Discovery ladder (govee2mqtt order): multicast →
// per-interface broadcast → global broadcast → remembered-IP unicast.
// Values clamped in main (turn 0|1, brightness 1-100, RGB 0-255,
// Kelvin 2000-9000, 0 = pure RGB). Whole-device colorwc + brightness only:
// H6076 is single-zone over LAN, so frames collapse to the middle color.
export interface LanLight {
  reply: ScanReply;
  lastSeenMs: number;
}

export interface LanScanOptions {
  broadcastAddresses?: string[];
  unicastIps?: string[];
  timeoutMs?: number;
}

export function scanLan(opts: LanScanOptions = {}): Promise<ScanReply[]> {
  const timeoutMs = opts.timeoutMs ?? 3000;
  return new Promise((resolve) => {
    const found = new Map<string, ScanReply>();
    const socket = createSocket("udp4");
    const finish = (): void => {
      try { socket.close(); } catch { /* already closed */ }
      resolve([...found.values()]);
    };
    const timer = setTimeout(finish, timeoutMs);
    socket.on("message", (msg) => {
      try {
        const reply = parseScanReply(JSON.parse(msg.toString()));
        if (reply) {
          found.set(reply.device, reply);
          // Read-back verify: devStatus is the only command with a reply.
          try {
            socket.send(devStatusCommand(), 4003, reply.ip, () => undefined);
          } catch { /* verify best-effort */ }
        }
      } catch { /* non-JSON traffic on the shared port */ }
    });
    socket.on("error", () => { clearTimeout(timer); finish(); });
    socket.bind(4002, () => {
      try {
        socket.addMembership(MULTICAST);
      } catch { /* no multicast route — fall through to broadcast */ }
      const payload = JSON.stringify(SCAN_REQUEST);
      const send = (host: string, port = 4001): void => {
        try { socket.send(payload, port, host, () => undefined); } catch { /* unreachable */ }
      };
      send(MULTICAST);
      for (const b of opts.broadcastAddresses ?? []) send(b);
      try {
        socket.setBroadcast(true);
        send("255.255.255.255");
      } catch { /* broadcast blocked */ }
      for (const ip of opts.unicastIps ?? []) send(ip, 4001);
    });
  });
}

// Beat-synced frame → whole-device colorwc + brightness.
// Frame is an RGB24 buffer (3 bytes/segment); H6076 collapses to middle.
export function frameToLan(ip: string, frame: Uint8Array, brightness: number, sender: (msg: string) => void): void {
  const [r, g, b] = collapseToSingleColor(frame);
  if (r === 0 && g === 0 && b === 0) {
    sender(turnCommand(false));
    return;
  }
  sender(turnCommand(true));
  sender(brightnessCommand(brightness));
  sender(colorCommand(r, g, b));
}

export function parseStatusReply(raw: string): ReturnType<typeof parseDevStatus> {
  try {
    return parseDevStatus(JSON.parse(raw));
  } catch {
    return null;
  }
}
