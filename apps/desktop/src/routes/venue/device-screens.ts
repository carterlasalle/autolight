// Device screens (T-UI-08, spec 99): per-tile measurements plus transport
// mode selection. Pure descriptors over the tile rows the Venue feature
// already builds; RoomM4 owns routes/venue/ room editor files, this file is
// the only UiScreens file under that dir.

export type TransportMode = "hybrid" | "lan" | "ble";

export interface DeviceScreenRow {
  id: string;
  sku: string;
  ip: string | null;
  bleAddress: string | null;
  firmware: string;
  segments: number | null;
  qualifiedResolution: string;
  fps: number | null;
  sentFrames: number;
  supersededFrames: number;
  latencyMs: number | null;
  latencySource: "measured" | "sku-default" | "unmeasured";
  lastResponse: string | null;
  health: "online" | "degraded" | "offline";
  transportMode: TransportMode;
}

export function deviceScreenRow(tile: {
  id: string; sku: string; ip: string | null; firmware: string;
  segments: number; fps: number; sentFrames: number; supersededFrames: number;
  latencyMs: number; health: "online" | "degraded" | "offline";
}, qualified: boolean): DeviceScreenRow {
  return {
    id: tile.id,
    sku: tile.sku,
    ip: tile.ip,
    bleAddress: null,
    firmware: tile.firmware,
    segments: qualified && tile.segments > 0 ? tile.segments : null,
    qualifiedResolution: qualified ? `${tile.segments} segments` : "unmeasured",
    fps: qualified ? tile.fps : null,
    sentFrames: tile.sentFrames,
    supersededFrames: tile.supersededFrames,
    latencyMs: qualified ? tile.latencyMs : null,
    latencySource: qualified ? "measured" : "unmeasured",
    lastResponse: null,
    health: tile.health,
    transportMode: "hybrid",
  };
}

export function withTransportMode(row: DeviceScreenRow, mode: TransportMode): DeviceScreenRow {
  return { ...row, transportMode: mode };
}

export { SETUP_EVIDENCE_STEPS, setupProgress, type EvidenceStep } from "../setup/setup-model.js";
