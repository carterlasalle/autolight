// ptReal scenes over LAN (T-GOV-18, closes F-GOV-27).
//
// Provenance: wez/govee2mqtt src/lan_api.rs:188-250 carries base64
// BLE-format packets inside the LAN JSON `ptReal` command for scenes; the
// prior-art note in docs/research/prior-art-reuse.md records it as the local
// way to set scenes. Scene codes come from the cloud scene catalogue when
// the owner enables cloud, or from a stored catalogue. Never used for show
// frames: T-GOV-08 owns the razer stream, and this stays for setup, idle and
// ending looks (spec 133 ending look option "scene").
//
// Wire shape, per govee2mqtt: {"msg":{"cmd":"ptReal","data":{"command":[...]}}}
// where `command` is the array of BLE-format byte strings. The LAN envelope
// reuses the same device:4003 JSON datagram as the official commands; only
// the cmd name and the byte payload differ.
export interface SceneCatalog {
  source: "cloud" | "stored";
  scenes: Record<string, string[]>;
}

export function ptRealCommand(sceneBytes: readonly string[]): string {
  return JSON.stringify({ msg: { cmd: "ptReal", data: { command: [...sceneBytes] } } });
}
export function parsePtRealCommand(raw: unknown): string[] | null {
  if (typeof raw !== "object" || raw === null || !("msg" in raw)) return null;
  const msg = raw.msg;
  if (typeof msg !== "object" || msg === null || !("cmd" in msg) || !("data" in msg)) return null;
  if (msg.cmd !== "ptReal") return null;
  const data = msg.data;
  if (typeof data !== "object" || data === null || !("command" in data)) return null;
  const command = data.command;
  if (!Array.isArray(command) || command.length === 0) return null;
  if (!command.every((entry) => typeof entry === "string" && entry.length > 0)) return null;
  return [...command];
}
export function sceneFromCatalog(catalog: SceneCatalog, name: string): string[] | null {
  const scene = catalog.scenes[name];
  if (!scene || scene.length === 0) return null;
  return [...scene];
}

export function listScenes(catalog: SceneCatalog): string[] {
  return Object.keys(catalog.scenes).sort();
}

export type SceneMoment = "setup" | "idle" | "ending";

export interface SceneRequest {
  scene: string;
  moment: SceneMoment;
  catalog: SceneCatalog;
}

/** Resolves a scene name to the LAN datagram, or null with the reason. */
export function sceneCommand(request: SceneRequest): { json: string; bytes: string[] } | { error: string } {
  const bytes = sceneFromCatalog(request.catalog, request.scene);
  if (!bytes) {
    return { error: `scene ${request.scene} is not in the ${request.catalog.source} catalogue (${request.moment})` };
  }
  return { json: ptRealCommand(bytes), bytes };
}
