// T-FOV-01 transport model tests: the P-148 ladder, all eight per-device
// modes proving which transport carried the bytes, strict/auto/hybrid
// policy behaviour, and the cloud-basic show-tick rejection.
import { describe, expect, it } from "vitest";
import {
  authorizeCloudBasic,
  DEFAULT_TRANSPORT_ORDER,
  FRAME_CLASS,
  modeAvailability,
  routeFrame,
  selectFrameTransport,
  TRANSPORTS,
  type FixtureTransportConfig,
  type FrameSink,
  type TransportId,
} from "./transports.js";

function cfg(over: Partial<FixtureTransportConfig> = {}): FixtureTransportConfig {
  const { status, ...rest } = over;
  return {
    fixtureId: "lamp1",
    mode: "hybrid",
    policy: "hybrid",
    order: [...DEFAULT_TRANSPORT_ORDER],
    status: {
      "lan-razer": { verified: true, reachable: true },
      "ble-segmented": { verified: true, reachable: true },
      "lan-json": { verified: true, reachable: true },
      "ble-single": { verified: true, reachable: true },
      matter: { verified: true, reachable: true },
      ...status,
    },
    cloudAllowed: false,
    fromShowTick: false,
    ...rest,
  };
}

function sinks(): { list: FrameSink[]; carried: TransportId[] } {
  const carried: TransportId[] = [];
  const list: FrameSink[] = TRANSPORTS.filter((t) => t !== "cloud-metadata").map((t) => ({
    transport: t,
    send: () => {
      carried.push(t);
    },
  }));
  return { list, carried };
}

const FRAME = new Uint8Array([255, 0, 0, 0, 0, 255]);

describe("transport model and policy (P-148 ladder)", () => {
  it("holds LAN segmented while it is up", () => {
    const sel = selectFrameTransport(cfg());
    expect(sel.transport).toBe("lan-razer");
    expect(sel.frameClass).toBe("segments");
    expect(sel.banner).toBeNull();
  });

  it("fails LAN blocked to BLE segmented, keeping segment frames", () => {
    const sel = selectFrameTransport(
      cfg({ status: { "lan-razer": { verified: true, reachable: false } } }),
    );
    expect(sel.transport).toBe("ble-segmented");
    expect(sel.frameClass).toBe("segments");
  });

  it("falls both segmented paths to whole-fixture LAN JSON with a banner", () => {
    const sel = selectFrameTransport(
      cfg({
        status: {
          "lan-razer": { verified: true, reachable: false },
          "ble-segmented": { verified: true, reachable: false },
          "lan-json": { verified: true, reachable: true },
        },
      }),
    );
    expect(sel.transport).toBe("lan-json");
    expect(sel.frameClass).toBe("whole");
    expect(sel.degraded).toBe(true);
    expect(sel.banner).toContain("lan-json");
  });

  it("falls to Matter whole-fixture when every LAN and BLE path is down", () => {
    const sel = selectFrameTransport(
      cfg({
        status: {
          "lan-razer": { verified: true, reachable: false },
          "ble-segmented": { verified: true, reachable: false },
          "lan-json": { verified: true, reachable: false },
          "ble-single": { verified: true, reachable: false },
          matter: { verified: true, reachable: true },
        },
      }),
    );
    expect(sel.transport).toBe("matter");
    expect(sel.frameClass).toBe("whole");
  });

  it("never routes frames to cloud under any policy", () => {
    const down = {
      "lan-razer": { verified: false, reachable: false },
      "ble-segmented": { verified: false, reachable: false },
      "lan-json": { verified: false, reachable: false },
      "ble-single": { verified: false, reachable: false },
      matter: { verified: false, reachable: false },
    } as const;
    for (const policy of ["strict", "auto", "hybrid"] as const) {
      const sel = selectFrameTransport(cfg({ policy, status: { ...down } }));
      expect(sel.transport).not.toBe("cloud-metadata");
    }
    expect(FRAME_CLASS["cloud-metadata"]).toBe("never");
  });

  it("goes dark with a banner when every frame transport is down", () => {
    const sel = selectFrameTransport(
      cfg({
        status: {
          "lan-razer": { verified: false, reachable: false },
          "ble-segmented": { verified: false, reachable: false },
          "lan-json": { verified: false, reachable: false },
          "ble-single": { verified: false, reachable: false },
          matter: { verified: false, reachable: false },
        },
      }),
    );
    expect(sel.transport).toBeNull();
    expect(sel.banner).toContain("dark");
  });
});

describe("per-device modes carry bytes on the pinned transport", () => {
  const cases = [
    { mode: "lan-segmented", expect: "lan-razer" },
    { mode: "lan-basic", expect: "lan-json" },
    { mode: "ble-segmented", expect: "ble-segmented" },
    { mode: "ble-basic", expect: "ble-single" },
    { mode: "matter-basic", expect: "matter" },
  ] as const;
  for (const c of cases) {
    it(`${c.mode} sends through ${c.expect}`, () => {
      const sel = selectFrameTransport(cfg({ mode: c.mode }));
      expect(sel.pinned).toBe(true);
      const { list, carried } = sinks();
      expect(routeFrame(sel, FRAME, list)).toBe(c.expect);
      expect(carried).toEqual([c.expect]);
    });
  }

  it("auto follows the best verified transport at the moment", () => {
    const sel = selectFrameTransport(cfg({ mode: "auto", policy: "auto" }));
    expect(sel.transport).toBe("lan-razer");
    const down = selectFrameTransport(
      cfg({
        mode: "auto",
        policy: "auto",
        status: { "lan-razer": { verified: true, reachable: false } },
      }),
    );
    expect(down.transport).toBe("ble-segmented");
  });

  it("hybrid keeps segment frames off whole-fixture transports while any segmented path verifies", () => {
    const sel = selectFrameTransport(cfg({ mode: "hybrid" }));
    expect(sel.frameClass).toBe("segments");
    expect(sel.transport).toBe("lan-razer");
  });

  it("cloud-basic refuses the show tick and reports it", () => {
    const sel = selectFrameTransport(
      cfg({ mode: "cloud-basic", fromShowTick: true, cloudAllowed: true }),
    );
    expect(sel.transport).toBeNull();
    expect(sel.reason).toContain("show tick");
  });

  it("cloud-basic stays disabled until the owner enables cloud", () => {
    const auth = authorizeCloudBasic({ fromShowTick: false, cloudAllowed: false });
    expect(auth.allowed).toBe(false);
    const open = authorizeCloudBasic({ fromShowTick: false, cloudAllowed: true });
    expect(open.allowed).toBe(true);
  });
});

describe("strict policy and explicit modes never switch silently", () => {
  it("strict holds the first transport while it is down instead of switching", () => {
    const sel = selectFrameTransport(
      cfg({
        policy: "strict",
        status: {
          "lan-razer": { verified: true, reachable: false },
          "ble-segmented": { verified: true, reachable: true },
        },
      }),
    );
    expect(sel.transport).toBe("lan-razer");
    expect(sel.banner).toContain("never switches");
  });

  it("an explicit mode never overrides to another transport when its path drops", () => {
    const sel = selectFrameTransport(
      cfg({
        mode: "lan-segmented",
        status: { "lan-razer": { verified: true, reachable: false } },
      }),
    );
    expect(sel.transport).toBe("lan-razer");
    expect(sel.pinned).toBe(true);
    expect(sel.banner).toContain("never switches");
  });

  it("routeFrame throws when nothing is selected, so a dark fixture never sends", () => {
    const sel = selectFrameTransport(
      cfg({
        status: {
          "lan-razer": { verified: false, reachable: false },
          "ble-segmented": { verified: false, reachable: false },
          "lan-json": { verified: false, reachable: false },
          "ble-single": { verified: false, reachable: false },
          matter: { verified: false, reachable: false },
        },
      }),
    );
    expect(sel.transport).toBeNull();
    expect(() => routeFrame(sel, FRAME, sinks().list)).toThrowError(/No transport selected/);
  });
});

describe("mode availability reports the qualification reason", () => {
  it("disables BLE modes the unit never qualified", () => {
    const avail = modeAvailability("ble-segmented", {
      "lan-razer": { verified: true, reachable: true },
    });
    expect(avail.enabled).toBe(false);
    expect(avail.reason).toContain("BLE not qualified");
  });

  it("enables qualified modes and reports auto/hybrid coverage", () => {
    expect(
      modeAvailability("lan-segmented", { "lan-razer": { verified: true, reachable: true } }).enabled,
    ).toBe(true);
    expect(modeAvailability("hybrid", {}).enabled).toBe(false);
    expect(modeAvailability("auto", { matter: { verified: true, reachable: true } }).enabled).toBe(true);
  });
});
