// T-GOV-17 firmware policy tests (P-147-unknown-fw): known firmware keeps
// the segmented channel, unknown firmware gates to the verified fallback
// with a loud warning, unmeasured firmware keeps control but warns, and a
// failing raw stream is capped per window. No hardware claim.
import { describe, expect, it } from "vitest";
import { FirmwarePolicy } from "./firmware.js";

describe("FirmwarePolicy", () => {
  it("keeps the segmented channel when firmware matches the qualified record", () => {
    const policy = new FirmwarePolicy();
    const decision = policy.decide("1.02.03", "1.02.03", true);
    expect(decision.gate).toBe("segmented");
    expect(decision.warning).toBeNull();
  });

  it("gates unknown firmware to the verified fallback with a loud warning", () => {
    const policy = new FirmwarePolicy();
    const decision = policy.decide("1.02.03", "1.03.00", true);
    expect(decision.gate).toBe("verified-fallback");
    expect(decision.warning).toContain("1.03.00");
    expect(decision.warning).toContain("REQUALIFICATION REQUIRED");
    expect(decision.reason).toContain("8, 9, 12, 13");
  });

  it("treats unreadable firmware as unknown but keeps control, loudly", () => {
    const policy = new FirmwarePolicy();
    const kept = policy.decide("1.02.03", "unmeasured", true);
    expect(kept.gate).toBe("segmented");
    expect(kept.warning).not.toBeNull();
    const ungated = policy.decide("1.02.03", "", false);
    expect(ungated.gate).toBe("verified-fallback");
    expect(ungated.warning).not.toBeNull();
  });

  it("caps re-arms of a failing raw stream per window", () => {
    let now = 0;
    const policy = new FirmwarePolicy({ maxRearmAttempts: 3, rearmWindowMs: 1000, clock: () => now });
    expect(policy.mayRearm()).toBe(true);
    expect(policy.mayRearm()).toBe(true);
    expect(policy.mayRearm()).toBe(true);
    expect(policy.mayRearm()).toBe(false);
    expect(policy.rearmCount()).toBe(3);
    now = 2000;
    expect(policy.mayRearm()).toBe(true);
  });
});
