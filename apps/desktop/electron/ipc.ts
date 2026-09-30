import { ipcMain } from "electron";
import { z } from "zod";
import {
  scanLanCommand, identifyCommand, testChaseCommand,
  pollAxCommand, listAudioDevices, readAudioLevel,
  readDiagnostics, readLiveShow,
} from "./show-service.js";
const channels = {
  "venue/list": z.object({ version: z.literal(1) }),
  "venue/set-color": z.object({ version: z.literal(1), rgb: z.tuple([z.number(), z.number(), z.number()]) }),
  "venue/device-action": z.object({ version: z.literal(1), id: z.string(), action: z.string() }),
  "venue/scan": z.object({ version: z.literal(1) }),
  "venue/identify": z.object({ version: z.literal(1), id: z.string() }),
  "venue/test-chase": z.object({ version: z.literal(1), id: z.string() }),
  "show/state": z.object({ version: z.literal(1), deck: z.number() }),
  "show/live": z.object({ version: z.literal(1) }),
  "show/style": z.object({ version: z.literal(1), style: z.string(), palette: z.string() }),
  "show/energy": z.object({ version: z.literal(1), tier: z.string() }),
  "show/trigger-build": z.object({ version: z.literal(1) }),
  "show/trigger-drop": z.object({ version: z.literal(1) }),
  "follow/ax": z.object({ version: z.literal(1) }),
  "follow/mode": z.object({ version: z.literal(1), mode: z.string() }),
  "audio/devices": z.object({ version: z.literal(1) }),
  "audio/level": z.object({ version: z.literal(1) }),
  // Emergency controls (§94): BLACKOUT needs no modal; keyboard shortcuts exist.
  "master/blackout": z.object({ version: z.literal(1) }),
  "master/full": z.object({ version: z.literal(1) }),
  "master/freeze": z.object({ version: z.literal(1), frozen: z.boolean() }),
  "master/intensity": z.object({ version: z.literal(1), value: z.number().min(0).max(1) }),
  "master/resume": z.object({ version: z.literal(1), at: z.enum(["beat", "bar", "phrase", "immediate"]) }),
  // Diagnostics tabs (§101): DJ events, transport, clock, analysis, planner,
  // renderer, fixtures, latency, logs.
  "diagnostics/get": z.object({ version: z.literal(1), tab: z.string() }),
  "diagnostics/all": z.object({ version: z.literal(1) }),
} as const;
export type Channel = keyof typeof channels;

export function createIpc(): void {
  const extra: Record<string, (...args: never[]) => unknown> = {
    "venue/scan": () => scanLanCommand(),
    "venue/identify": (_e: unknown, payload: unknown) => identifyCommand((payload as { id: string }).id),
    "venue/test-chase": (_e: unknown, payload: unknown) => testChaseCommand((payload as { id: string }).id),
    "follow/ax": () => pollAxCommand(),
    "audio/devices": () => listAudioDevices(),
    "audio/level": () => readAudioLevel(),
    "diagnostics/all": () => readDiagnostics(),
    "show/live": () => readLiveShow(),
  };
  for (const [ch, schema] of Object.entries(channels)) {
    if (ch in extra) continue; // real handler wins over schema echo
    ipcMain.handle(ch, (_e, payload) => schema.parse(payload));
  }
  for (const [ch, fn] of Object.entries(extra)) ipcMain.handle(ch, fn as (e: unknown, p: unknown) => unknown);
}
