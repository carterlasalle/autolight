import { ipcMain } from "electron";
import { z } from "zod";

const channels = {
  "venue/list": z.object({ version: z.literal(1) }),
  "show/state": z.object({ version: z.literal(1), deck: z.number() }),
} as const;
export type Channel = keyof typeof channels;

export function createIpc(): void {
  for (const [ch, schema] of Object.entries(channels)) {
    ipcMain.handle(ch, (_e, payload) => schema.parse(payload));
  }
}
