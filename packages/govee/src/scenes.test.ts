// T-GOV-18 ptReal tests: the LAN JSON envelope round-trips, unknown scenes
// fail with a named reason, and scene code only ever resolves for setup,
// idle and ending moments, never for show frames (no "show" moment exists).
import { describe, expect, it } from "vitest";
import {
  listScenes,
  parsePtRealCommand,
  ptRealCommand,
  sceneCommand,
  sceneFromCatalog,
  type SceneCatalog,
} from "./scenes.js";

const CATALOG: SceneCatalog = {
  source: "stored",
  scenes: { sunset: ["ab12", "cd34"], ocean: ["ff00"] },
};

describe("ptReal scenes", () => {
  it("round-trips the LAN envelope with the scene bytes intact", () => {
    const json = ptRealCommand(["ab12", "cd34"]);
    expect(JSON.parse(json).msg.cmd).toBe("ptReal");
    expect(parsePtRealCommand(JSON.parse(json))).toEqual(["ab12", "cd34"]);
  });

  it("rejects anything that is not a ptReal packet", () => {
    expect(parsePtRealCommand({ msg: { cmd: "turn", data: { value: 1 } } })).toBeNull();
    expect(parsePtRealCommand({})).toBeNull();
    expect(parsePtRealCommand({ msg: { cmd: "ptReal", data: { command: [] } } })).toBeNull();
  });

  it("resolves scenes from the catalogue, sorted, with copies", () => {
    expect(listScenes(CATALOG)).toEqual(["ocean", "sunset"]);
    const bytes = sceneFromCatalog(CATALOG, "sunset");
    expect(bytes).toEqual(["ab12", "cd34"]);
    expect(sceneFromCatalog(CATALOG, "missing")).toBeNull();
  });

  it("builds the ending-look datagram and names an unknown scene", () => {
    const ok = sceneCommand({ scene: "sunset", moment: "ending", catalog: CATALOG });
    expect("json" in ok && JSON.parse(ok.json).msg.cmd).toBe("ptReal");
    const missing = sceneCommand({ scene: "missing", moment: "ending", catalog: CATALOG });
    expect("error" in missing && missing.error).toContain("missing");
    expect("error" in missing && missing.error).toContain("ending");
  });
});
