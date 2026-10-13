// Network exposure audit (T-SEC-02, F-GOV-20 binding part, spec 110/111).
// Binds only necessary interfaces (govee.lan.interfaces, loopback for OSC
// and local sidecars); never listens on non-loopback except the Govee UDP
// ports and discovery protocols that require it (PRO DJ LINK, Serato Remote
// Bonjour, OS2L), each listed with its reason in Diagnostics. No externally
// reachable control server by default; no command bridging to other networks.

export interface ListenerDecl {
  name: string;
  host: string;
  port: number;
  reason: string;
  loopbackOnly: boolean;
}

function isLoopback(host: string): boolean {
  const n = host.trim().toLowerCase().replace(/^\[|\]$/g, "");

  return n === "::1" || n === "localhost" || /^127\./.test(n) || n === "0:0:0:0:0:0:0:1";
}

const ALLOWED_NON_LOOPBACK: ReadonlyArray<{ port: number; reason: string }> = [
  { port: 4001, reason: "Govee LAN scan listener (UDP 4001)" },
  { port: 4002, reason: "Govee LAN reply listener (UDP 4002)" },
  { port: 4003, reason: "Govee LAN control listener (UDP 4003)" },
];

const ALLOWED_DISCOVERY: ReadonlyArray<{ name: string; reason: string }> = [
  { name: "prolink", reason: "PRO DJ LINK discovery requires LAN multicast" },
  { name: "prolink-discovery", reason: "PRO DJ LINK discovery requires LAN multicast" },
  { name: "serato-bonjour", reason: "Serato Remote Bonjour (_SeratoIOSRemote._tcp)" },
  { name: "os2l", reason: "OS2L discovery service type" },
];

export interface NetworkAuditResult {
  allowed: ListenerDecl[];
  denied: { listener: ListenerDecl; reason: string }[];
}

export function auditListeners(listeners: readonly ListenerDecl[]): NetworkAuditResult {
  const allowed: ListenerDecl[] = [];
  const denied: { listener: ListenerDecl; reason: string }[] = [];

  for (const l of listeners) {
    if (isLoopback(l.host)) {
      allowed.push(l);
      continue;
    }

    if (l.loopbackOnly) {
      denied.push({ listener: l, reason: `${l.name}: declared loopback-only but bound to ${l.host}` });
      continue;
    }

    // Govee LAN requires multicast/broadcast reception from the subnet, so the
    // UDP ports are allowed only on the wildcard interfaces every NIC shares.
    // A public or single-NIC unicast bind is not a discovery listener.
    const portRule = ALLOWED_NON_LOOPBACK.find((r) => r.port === l.port);
    const host = l.host.trim();

    if (portRule !== undefined && (host === "0.0.0.0" || host === "::")) {
      allowed.push({ ...l, reason: portRule.reason });
      continue;
    }

    const discovery = ALLOWED_DISCOVERY.find((r) => l.name.toLowerCase() === r.name);

    if (discovery !== undefined) {
      allowed.push({ ...l, reason: discovery.reason });
      continue;
    }

    denied.push({ listener: l, reason: `${l.name}: non-loopback ${l.host}:${l.port} has no listed discovery reason` });
  }

  return { allowed, denied };
}

export function oscMustRefuseRemote(host: string): boolean {
  return !isLoopback(host);
}
