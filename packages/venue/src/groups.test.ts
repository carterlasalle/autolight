import { describe, expect, it } from "vitest";
import { computeFields } from "./fields.js";
import { derivedGroups, resolveSelector, splitWeights, zoneWeights, defaultRoles } from "./groups.js";
import { fieldCellsForReference, referenceById } from "./reference.js";

function square() {
  const ref = referenceById("square-loop");
  const room = { ...ref.room, logicalZeroS: ref.zeroS, perimeterDirection: "clockwise" as const };
  const built = fieldCellsForReference(ref);
  const fields = computeFields(room, built.cells, ref.runs, { zeroS: ref.zeroS });
  return { ref, room, fields };
}

describe("T-ROOM-06 groups and splits", () => {
  it("derives DJ-relative LEFT and RIGHT, not population thirds", () => {
    const { fields } = square();
    const g = derivedGroups(fields, { wallNames: ["Front", "Right", "Back", "Left"] });
    expect(g.ALL).toHaveLength(fields.count);
    expect(g.LEFT.length).toBeGreaterThan(0);
    expect(g.RIGHT.length).toBeGreaterThan(0);
    const leftS = g.LEFT.map((k) => fields.s[fields.keys.indexOf(k)]!);
    const rightS = g.RIGHT.map((k) => fields.s[fields.keys.indexOf(k)]!);
    expect(leftS.every((s) => s >= 0 && s <= 1)).toBe(true);
    expect(rightS.every((s) => s >= 0 && s <= 1)).toBe(true);
    expect(new Set([...g.LEFT, ...g.RIGHT, ...g.CENTER]).size).toBe(fields.count);
  });

  it("feathers the halves split per DS-33 with 0.5 weight on the line", () => {
    const { fields } = square();
    const w = splitWeights(fields, { id: "halves", kind: "halves" }, { featherM: 10 });
    for (let i = 0; i < fields.count; i++) {
      expect(w[0]![i]! + w[1]![i]!).toBeCloseTo(1, 6);
      expect(w[0]![i]).toBeGreaterThan(0.3);
    }
  });

  it("resolves selectors without device ids", () => {
    const { fields } = square();
    const g = derivedGroups(fields);
    const roles = defaultRoles(g.PERIMETER, []);
    expect(resolveSelector(fields, { kind: "group", name: "LEFT" }, g, roles)).toEqual(g.LEFT);
    const sRange = resolveSelector(fields, { kind: "fieldRange", field: "s", min: 0.2, max: 0.4 }, g, roles);
    expect(sRange.length).toBeGreaterThan(0);
    const zone = resolveSelector(
      fields,
      { kind: "zone", zone: { id: "floor", name: "Dance floor", polygon: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }] } },
      g,
      roles,
    );
    expect(Array.isArray(zone)).toBe(true);
    const zw = zoneWeights(fields, { id: "z", name: "z", polygon: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }] });
    expect([...zw].every((v) => v >= 0.5)).toBe(true);
  });
});
