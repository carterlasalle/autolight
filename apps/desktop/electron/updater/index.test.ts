import { describe, expect, it } from "vitest";
import {
  canInstallUpdate,
  decideUpdateCheck,
  noteUpdateAvailable,
} from "./index.js";

// T-OPS-04: updates never install during Live or with a show loaded; an
// available update during Live defers with a status notice and no modal.
describe("update strategy (T-OPS-04, spec 145)", () => {
  it("checks only when enabled and nothing live is running", () => {
    expect(decideUpdateCheck({ checkOnLaunch: true, liveActive: false, showLoaded: false }).action).toBe("check");
    expect(decideUpdateCheck({ checkOnLaunch: false, liveActive: false, showLoaded: false }).action).toBe(
      "skip-disabled",
    );
  });

  it("defers checks while Live is active or a show is loaded", () => {
    expect(decideUpdateCheck({ checkOnLaunch: true, liveActive: true, showLoaded: false }).action).toBe("defer-live");
    expect(decideUpdateCheck({ checkOnLaunch: true, liveActive: false, showLoaded: true }).action).toBe("defer-live");
    // Disabled wins the report even while Live is active or a show is
    // loaded: the ordering is pinned, not incidental (batch-46).
    expect(decideUpdateCheck({ checkOnLaunch: false, liveActive: true, showLoaded: false }).action).toBe("skip-disabled");
    expect(decideUpdateCheck({ checkOnLaunch: false, liveActive: false, showLoaded: true }).action).toBe("skip-disabled");
    expect(canInstallUpdate(true, false)).toBe(false);
    expect(canInstallUpdate(false, true)).toBe(false);
    expect(canInstallUpdate(false, false)).toBe(true);
    // Both blockers at once is exactly the case that must stay closed.
    expect(canInstallUpdate(true, true)).toBe(false);
  });

  it("notes an available update during Live without a modal", () => {
    const state = noteUpdateAvailable("2.1.0", true);

    // The no-modal contract is structural: the state carries exactly these
    // three fields, so no modal/result flag can ride along, and the notice
    // names the deferral.
    expect(state).toEqual({
      available: "2.1.0",
      deferred: true,
      notice: expect.stringContaining("status notice only, spec 144"),
    });
    const idle = noteUpdateAvailable("2.1.0", false);

    expect(idle).toEqual({ available: "2.1.0", deferred: false, notice: "update 2.1.0 available" });
    // A loaded show defers exactly like Live does (batch-17).
    const showLoaded = noteUpdateAvailable("2.1.0", false, true);

    expect(showLoaded).toEqual({
      available: "2.1.0",
      deferred: true,
      notice: expect.stringContaining("after the show"),
    });
  });
});
