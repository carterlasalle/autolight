import { ipcMain } from "electron";
import { z } from "zod";

// Typed versioned IPC (§87): narrow preload surface, no direct Node in renderer.
const channels = {
  "venue/list": z.object({ version: z.literal(1) }),
  "show/state": z.object({ version: z.literal(1), deck: z.number() }),
  // Emergency controls (§94): BLACKOUT needs no modal; keyboard shortcuts exist.
  "master/blackout": z.object({ version: z.literal(1) }),
  "master/full": z.object({ version: z.literal(1) }),
  "master/freeze": z.object({ version: z.literal(1), frozen: z.boolean() }),
  "master/intensity": z.object({ version: z.literal(1), value: z.number().min(0).max(1) }),
  "master/resume": z.object({ version: z.literal(1), at: z.enum(["beat", "bar", "phrase", "immediate"]) }),
  // Diagnostics tabs (§101): DJ events, transport, clock, analysis, planner,
  // renderer, fixtures, latency, logs.
  "diagnostics/get": z.object({ version: z.literal(1), tab: z.string() }),
} as const;
export type Channel = keyof typeof channels;

export function createIpc(): void {
  for (const [ch, schema] of Object.entries(channels)) {
    ipcMain.handle(ch, (_e, payload) => schema.parse(payload));
  }
}
