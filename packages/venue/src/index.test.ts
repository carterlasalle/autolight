import { describe, expect, it } from "vitest";
import { globalCellOrder } from "./index.js";
import type { Fixture } from "@autolight/contracts";

const mk = (id: string, xs: number[]): Fixture => ({
  id, adapter: "govee", sku: "H6076", hardwareId: id,
  cells: xs.map((x, i) => ({ index: i, position: { x, y: 0 }, order: i, tags: [] })),
  calibration: null,
});

describe("venue", () => {
  it("orders cells left-to-right across fixtures", () => {
    const order = globalCellOrder([mk("right", [0.9]), mk("left", [0.1])]);
    expect(order.map((c) => c.fixtureId)).toEqual(["left", "right"]);
  });
});
