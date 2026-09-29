import { app, BrowserWindow } from "electron";
import { createIpc } from "./ipc.js";

// Startup sequence (§132): DB → show worker → Govee → DJ adapter →
// library watcher → analysis worker → venue → tracks → plans → arm → READY.
export async function boot(): Promise<void> {
  await app.whenReady();
  const win = new BrowserWindow({ width: 1600, height: 900 });
  void win;
  createIpc();
}
void boot();
