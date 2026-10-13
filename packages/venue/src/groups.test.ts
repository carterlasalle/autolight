import { describe, expect, it } from "vitest";
import { computeFields, SIDE_LEFT, SIDE_RIGHT } from "./fields.js";
import { derivedGroups, resolveSelector, splitWeights, zoneWeights, defaultRoles } from "./groups.js";
import { fieldCellsForReference, referenceById } from "./reference.js";

// Geometry the constants below derive from (square-loop reference room): a
// 5 m square (half-size 2.5 m) with the closed ceiling loop running on the
// outline (|x| = 2.5 or |y| = 2.5). A ±1 m polygon covers only the room
// center, so the loop falls fully outside it; a ±5 m polygon encloses the
// loop with a ≥2.5 m edge margin, so every cell is deep inside.
const INNER_HALF_M = 1;
const OUTER_HALF_M = 5;
function squarePoly(halfM: number): { x: number; y: number }[] {
  return [
    { x: -halfM, y: -halfM },
    { x: halfM, y: -halfM },
    { x: halfM, y: halfM },
    { x: -halfM, y: halfM },
  ];
}
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
    // DJ-relative, not normalized-position: LEFT/RIGHT follow fields.side
    // (the DJ-facing x coordinate) and CENTER holds the remainder.
    const sideOf = (k: string): number => fields.side[fields.keys.indexOf(k)]!;
    expect(g.LEFT.every((k) => sideOf(k) === SIDE_LEFT)).toBe(true);
    expect(g.RIGHT.every((k) => sideOf(k) === SIDE_RIGHT)).toBe(true);
    expect(g.CENTER.every((k) => sideOf(k) !== SIDE_LEFT && sideOf(k) !== SIDE_RIGHT)).toBe(true);
    // Explicit partition: disjoint and jointly exhaustive.
    const seen = new Set<string>();
    for (const k of [...g.LEFT, ...g.RIGHT, ...g.CENTER]) {
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
    expect(seen.size).toBe(fields.count);
  });

  it("feathers the halves split per DS-33 with 0.5 weight on the line", () => {
    const { fields } = square();
    // featherM 10 m dwarfs the 5 m room: a gentle ramp with the line cell at
    // 0.5, strictly inside (0, 1) everywhere.
    const w = splitWeights(fields, { id: "halves", kind: "halves" }, { featherM: 10 });

    for (let i = 0; i < fields.count; i++) {
      expect(w[0]![i]! + w[1]![i]!).toBeCloseTo(1, 6);
    }

    const bySplit = Array.from({ length: fields.count }, (_, i) => i)
      .sort((a, b) => fields.signedSplit[a]! - fields.signedSplit[b]!);
    let nearest = bySplit[0]!;

    for (const i of bySplit) {
      if (Math.abs(fields.signedSplit[i]!) < Math.abs(fields.signedSplit[nearest]!)) nearest = i;
    }

    expect(w[0]![nearest]!).toBeCloseTo(0.5, 1);

    for (let n = 1; n < bySplit.length; n++) {
      expect(w[0]![bySplit[n]!]!).toBeGreaterThanOrEqual(w[0]![bySplit[n - 1]!]!);
    }

    const vals = bySplit.map((i) => w[0]![i]!);
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0);
  });

  it("resolves selectors without device ids", () => {
    const { fields } = square();
    const g = derivedGroups(fields);
    const roles = defaultRoles(g.PERIMETER, []);
    expect(resolveSelector(fields, { kind: "group", name: "LEFT" }, g, roles)).toEqual(g.LEFT);
    const sRange = resolveSelector(fields, { kind: "fieldRange", field: "s", min: 0.2, max: 0.4 }, g, roles);
    expect(sRange.length).toBeGreaterThan(0);

    for (const k of sRange) {
      const s = fields.s[fields.keys.indexOf(k)]!;
      expect(s).toBeGreaterThanOrEqual(0.2);
      expect(s).toBeLessThanOrEqual(0.4);
    }

    // The ±1 m dance-floor polygon sits inside the 2.5 m loop: empty is the
    // correct concrete membership, not a threshold miss.
    const zone = resolveSelector(
      fields,
      { kind: "zone", zone: { id: "floor", name: "Dance floor", polygon: squarePoly(INNER_HALF_M) } },
      g,
      roles,
    );
    expect(zone).toEqual([]);

    // The ±5 m polygon encloses the loop with margin: every cell fully in.
    const zw = zoneWeights(fields, { id: "z", name: "z", polygon: squarePoly(OUTER_HALF_M) });

    for (const v of zw) expect(v).toBeCloseTo(1, 6);

    expect(
      resolveSelector(fields, { kind: "zone", zone: { id: "z", name: "z", polygon: squarePoly(OUTER_HALF_M) } }, g, roles),
    ).toEqual(fields.keys);
  });
});
