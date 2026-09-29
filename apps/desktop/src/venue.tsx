import type { Fixture } from "@autolight/contracts";

// Venue screen (§98): 2D canvas ops — drag/rotate/reverse/resize/tag/identify/preview/calibrate.
// Device screen (§99): tile per fixture with health + IDENTIFY/TEST CHASE/RECALIBRATE.
export interface DeviceTile {
  id: string; sku: string; ip: string | null; firmware: string;
  segments: number; fps: number; sentFrames: number; supersededFrames: number;
  latencyMs: number; health: "online" | "degraded" | "offline";
}

export function tileForFixture(f: Fixture, stats: { fps: number; sent: number; superseded: number; latencyMs: number; health: DeviceTile["health"]; ip: string | null }): DeviceTile {
  return {
    id: f.id, sku: f.sku, ip: stats.ip, firmware: f.calibration?.firmwareVersion ?? "unknown",
    segments: f.cells.length, fps: stats.fps, sentFrames: stats.sent,
    supersededFrames: stats.superseded, latencyMs: stats.latencyMs, health: stats.health,
  };
}

// Setup wizard steps (§100): dj → controller → library → lights → identify →
// placement → orientation → qualification → analysis → preview → ready.
export const SETUP_STEPS = [
  "dj", "controller", "library", "lights", "identify",
  "placement", "orientation", "qualification", "analysis", "preview",
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export function nextSetupStep(done: SetupStep[]): SetupStep | "ready" {
  return SETUP_STEPS.find((s) => !done.includes(s)) ?? "ready";
}
