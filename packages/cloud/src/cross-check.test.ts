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
    // The full note, labeled: bare digit substrings would pass with the
    // values narrated backwards (batch-54).
    expect(out.evidenceNote).toBe(
      "Cloud declares 20 segments for H6076 but the wizard measured 14. Measured count kept; mismatch recorded.",
    );
  });

  it("drives a real parsed declared count through the cross-check (parse precedence)", () => {
    const parsed = parseDeviceEntry({
      device: "AA:BB:CC:DD:EE:01",
      model: "H6076",
      deviceName: "Desk Strip",
      controllable: true,
      retrievable: true,
      supportCmds: [],
      properties: { segmentCount: "12", zoneCount: 20, segments: 12.9 },
    });

    // segments wins, floors to 12; a string key never counts.
    expect(parsed.capabilities.declaredSegmentCount).toBe(12);
    const out = crossCheckQualification({
      hardwareId: "AA:BB:CC:DD:EE:01",
      model: "H6076",
      measuredSegmentCount: 14,
      cloud: parsed,
    });

    expect(out.comparison).toBe("disagree");
    expect(out.declaredSegmentCount).toBe(12);
    expect(out.mismatchRecorded).toBe(true);
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

  it("handles degenerate declared values explicitly", () => {
    // NaN never agrees: the comparison is strict equality.
    expect(compareDeclaredSegments(Number.NaN, Number.NaN)).toBe("disagree");
    // A fractional declaration is its own value, not a silent agreement.
    expect(compareDeclaredSegments(14.5, 14)).toBe("disagree");
    // A cloud declaring 0 flows through the parser as silent (0 is not a
    // usable count), never as a false agreement with a zero measurement...
    const zero = parseDeviceEntry({
      device: "d",
      model: "H6076",
      deviceName: "x",
      controllable: true,
      retrievable: true,
      supportCmds: [],
      properties: { segments: 0 },
    });

    expect(zero.capabilities.declaredSegmentCount).toBeNull();
    expect(compareDeclaredSegments(0, zero.capabilities.declaredSegmentCount)).toBe("cloud-silent");
    // ...while a direct zero-to-zero comparison is a real agreement.
    expect(compareDeclaredSegments(0, 0)).toBe("agree");
    expect(compareDeclaredSegments(14, 0)).toBe("disagree");
  });
});
