import { describe, expect, it } from "vitest";
import { shortcutFor, isModalAllowed } from "./shortcuts.js";

describe("shortcuts", () => {
  it("maps emergency keys without modals", () => {
    expect(shortcutFor("b")).toBe("master/blackout");
    expect(shortcutFor("B")).toBe("master/blackout");
    expect(shortcutFor("q")).toBeNull();
  });
  it("forbids modals during Live", () => {
    expect(isModalAllowed(true)).toBe(false);
    expect(isModalAllowed(false)).toBe(true);
  });
});
