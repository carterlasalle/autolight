// T-CLD-02 cross-check tests: a declared count that disagrees is recorded
// while the measured count stands; agreement and silence record nothing.
import { describe, expect, it } from "vitest";
import {
  compareDeclaredSegments,
  crossCheckQualification,
} from "./cross-check.js";
import { parseDeviceEntry } from "./client.js";

function cloudDevice(declared: number | null) {
  return {
    deviceId: "AA:BB:CC:DD:EE:01",
    model: "H6076",
    name: "Desk Strip",
    capabilities: {
      declaredSegmentCount: declared,
      instances: ["turn", "brightness"],
      controllable: true,
      retrievable: true,
    },
  };
}

describe("cloud cross-check in qualification", () => {
  it("records a mismatch when the declared count disagrees, keeping the measured count", () => {
    const out = crossCheckQualification({
      hardwareId: "AA:BB:CC:DD:EE:01",
      model: "H6076",
      measuredSegmentCount: 14,
      cloud: cloudDevice(20),
    });
    expect(out.comparison).toBe("disagree");
    expect(out.mismatchRecorded).toBe(true);
    expect(out.measuredSegmentCount).toBe(14);
    expect(out.declaredSegmentCount).toBe(20);
    expect(out.evidenceNote).toContain("14");
    expect(out.evidenceNote).toContain("20");
  });

  it("records nothing on agreement", () => {
    const out = crossCheckQualification({
      hardwareId: "AA:BB:CC:DD:EE:01",
      model: "H6076",
      measuredSegmentCount: 14,
      cloud: cloudDevice(14),
    });
    expect(out.comparison).toBe("agree");
    expect(out.mismatchRecorded).toBe(false);
    expect(out.measuredSegmentCount).toBe(14);
  });

  it("keeps the measured count when the cloud entry is silent", () => {
    const parsed = parseDeviceEntry({
      device: "d",
      model: "H1A45",
      deviceName: "Ceiling",
      controllable: true,
      retrievable: true,
      supportCmds: [],
    });
    const out = crossCheckQualification({
      hardwareId: "d",
      model: "H1A45",
      measuredSegmentCount: 8,
      cloud: parsed,
    });
    expect(out.comparison).toBe("cloud-silent");
    expect(out.mismatchRecorded).toBe(false);
    expect(out.measuredSegmentCount).toBe(8);
    expect(out.declaredSegmentCount).toBeNull();
  });

  it("stays silent when cloud metadata is absent entirely", () => {
    const out = crossCheckQualification({
      hardwareId: "d",
      model: "H1A45",
      measuredSegmentCount: 8,
      cloud: null,
    });
    expect(out.comparison).toBe("cloud-silent");
    expect(out.mismatchRecorded).toBe(false);
  });

  it("compares counts directly without touching the client", () => {
    expect(compareDeclaredSegments(14, 14)).toBe("agree");
    expect(compareDeclaredSegments(14, 20)).toBe("disagree");
    expect(compareDeclaredSegments(14, null)).toBe("cloud-silent");
  });
});
