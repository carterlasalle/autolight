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
    expect(canInstallUpdate(true, false)).toBe(false);
    expect(canInstallUpdate(false, true)).toBe(false);
    expect(canInstallUpdate(false, false)).toBe(true);
  });

  it("notes an available update during Live without a modal", () => {
    const state = noteUpdateAvailable({ available: null, deferred: false, notice: null }, "2.1.0", true);
    expect(state).toMatchObject({ available: "2.1.0", deferred: true });
    expect(state.notice).toContain("after Live");
    expect(state.notice).not.toContain("modal");
    const idle = noteUpdateAvailable({ available: null, deferred: false, notice: null }, "2.1.0", false);
    expect(idle.deferred).toBe(false);
  });
});
