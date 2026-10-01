// T-FOV-02 machine tests: the campus fault sequence against the policy,
// with measured switch instants, banners, and the bar-boundary reclaim.
import { describe, expect, it } from "vitest";
import {
  CAMPUS_SEQUENCE,
  FailoverMachine,
  type SwitchEvent,
} from "./machine.js";
import {
  DEFAULT_TRANSPORT_ORDER,
  type FixtureTransportConfig,
  type TransportId,
} from "./transports.js";

function makeMachine(
  reach: Record<string, { verified: boolean; reachable: boolean }>,
  at: { ms: number },
  events: SwitchEvent[],
  policy: FixtureTransportConfig["policy"] = "hybrid",
): FailoverMachine {
  return new FailoverMachine({
    fixtureId: "lamp1",
    config: () => ({
      fixtureId: "lamp1",
      mode: "hybrid",
      policy,
      order: [...DEFAULT_TRANSPORT_ORDER],
      status: { ...reach },
      cloudAllowed: false,
      fromShowTick: false,
    }),
    thresholds: { lanLossMs: 3000, probeIntervalMs: 10000 },
    onSwitch: (e) => events.push(e),
    now: () => at.ms,
  });
}

function fullReach(): Record<string, { verified: boolean; reachable: boolean }> {
  return {
    "lan-razer": { verified: true, reachable: true },
    "ble-segmented": { verified: true, reachable: true },
    "lan-json": { verified: true, reachable: true },
    "ble-single": { verified: true, reachable: true },
    matter: { verified: true, reachable: true },
  };
}

describe("failover machine and the campus scenario", () => {
  it("stays on LAN through blocked multicast, then fails to BLE on client isolation", () => {
    const at = { ms: 0 };
    const events: SwitchEvent[] = [];
    const reach = fullReach();
    const machine = makeMachine(reach, at, events);

    const multicast = CAMPUS_SEQUENCE[0];
    if (multicast === undefined) throw new Error("campus sequence lost its head");
    at.ms += multicast.advanceMs;
    machine.noteLanReply();
    const held = machine.tick(multicast.signal, multicast.atBarBoundary);
    expect(held.transport).toBe("lan-razer");
    expect(events).toHaveLength(0);

    const isolation = CAMPUS_SEQUENCE[1];
    if (isolation === undefined) throw new Error("campus sequence lost isolation");
    reach["lan-razer"] = { verified: true, reachable: false };
    reach["lan-json"] = { verified: true, reachable: false };
    at.ms += isolation.advanceMs;
    const failed = machine.tick(isolation.signal, isolation.atBarBoundary);
    expect(failed.transport).toBe("ble-segmented");
    expect(machine.effectiveTransport).toBe("ble-segmented");
    expect(events).toHaveLength(1);
    expect(events[0]?.from).toBe("lan-razer");
    expect(events[0]?.to).toBe("ble-segmented");
    expect(events[0]?.atMs).toBe(at.ms);
    expect(events[0]?.banner).toContain("ble-segmented");
  });

  it("rides a router restart on BLE, then reclaims LAN at a bar boundary", () => {
    const at = { ms: 0 };
    const events: SwitchEvent[] = [];
    const reach = fullReach();
    const machine = makeMachine(reach, at, events);
    machine.select();
    expect(machine.effectiveTransport).toBe("lan-razer");

    reach["lan-razer"] = { verified: true, reachable: false };
    reach["lan-json"] = { verified: true, reachable: false };
    at.ms += 4000;
    machine.tick("lan-silent", false);
    expect(machine.effectiveTransport).toBe("ble-segmented");
    expect(machine.machineState).toBe("failed-over");

    at.ms += 2000;
    const held = machine.tick("lan-silent", false);
    expect(held.transport).toBe("ble-segmented");

    reach["lan-razer"] = { verified: true, reachable: true };
    reach["lan-json"] = { verified: true, reachable: true };
    at.ms += 11000;
    machine.noteLanReply();
    const back = machine.tick("ok", true);
    expect(back.transport).toBe("lan-razer");
    expect(machine.effectiveTransport).toBe("lan-razer");
    expect(machine.machineState).toBe("on-preferred");
    const reclaim = events[events.length - 1];
    expect(reclaim?.to).toBe("lan-razer");
    expect(reclaim?.switchBackAtBar).toBe(true);
  });

  it("holds the reclaim off the bar boundary until the bar arrives", () => {
    const at = { ms: 0 };
    const events: SwitchEvent[] = [];
    const reach = fullReach();
    const machine = makeMachine(reach, at, events);
    machine.select();
    reach["lan-razer"] = { verified: true, reachable: false };
    reach["lan-json"] = { verified: true, reachable: false };
    at.ms += 4000;
    machine.tick("lan-silent", false);
    expect(machine.effectiveTransport).toBe("ble-segmented");

    reach["lan-razer"] = { verified: true, reachable: true };
    reach["lan-json"] = { verified: true, reachable: true };
    at.ms += 11000;
    machine.noteLanReply();
    machine.tick("ok", false);
    expect(machine.effectiveTransport).toBe("ble-segmented");
    machine.tick("ok", true);
    expect(machine.effectiveTransport).toBe("lan-razer");
  });

  it("falls past BLE to whole-fixture Matter when Wi-Fi drops and BLE is out of range", () => {
    const at = { ms: 0 };
    const reach = fullReach();
    const machine = makeMachine(reach, at, []);
    machine.select();
    for (const step of ["lan-razer", "lan-json", "ble-segmented", "ble-single"] as const) {
      reach[step] = { verified: true, reachable: false };
    }
    at.ms += 500;
    const sel = machine.tick("stream-fault", false);
    expect(sel.transport).toBe("matter");
    expect(sel.frameClass).toBe("whole");
    expect(sel.banner).toContain("matter");
  });

  it("strict policy rides the outage dark instead of switching", () => {
    const at = { ms: 0 };
    const reach = fullReach();
    const machine = makeMachine(reach, at, [], "strict");
    machine.select();
    expect(machine.effectiveTransport).toBe("lan-razer");
    at.ms += 4000;
    const sel = machine.tick("lan-silent", false);
    expect(sel.transport).toBe("lan-razer");
    expect(sel.banner).toContain("never switches");
  });

  it("exposes the campus sequence faults in order", () => {
    expect(CAMPUS_SEQUENCE.map((s) => s.fault)).toEqual([
      "multicast-blocked",
      "client-isolation",
      "router-restart",
      "wifi-drop",
      "ble-out-of-range",
      "lan-recovered-at-bar",
    ]);
    const transports: TransportId[] = [...DEFAULT_TRANSPORT_ORDER];
    expect(transports[0]).toBe("lan-razer");
    expect(transports).not.toContain("cloud-metadata");
  });
});
