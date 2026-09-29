import { contextBridge, ipcRenderer } from "electron";
// Narrow API only (§87): no direct Node fs/network in renderer.
export const api = {
  invoke: (channel: string, payload: unknown) => ipcRenderer.invoke(channel, payload),
};
contextBridge.exposeInMainWorld("autolight", api);
