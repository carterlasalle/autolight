import { describe, expect, it } from "vitest";
import { setupProgress } from "./setup-model.js";

describe("setup evidence steps (T-UI-09)", () => {
  it("marks steps done only with evidence", () => {
    expect(setupProgress({}).next).toBe("dj");
    expect(setupProgress({ dj: true, controller: true }).done).toEqual(["dj", "controller"]);
    const full = Object.fromEntries(
      ["dj", "controller", "library", "lights", "identify", "placement", "orientation", "qualification", "analysis", "preview"].map((s) => [s, true]),
    );
    expect(setupProgress(full as never).next).toBe("ready");
  });
});
