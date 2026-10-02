import { contextBridge, ipcRenderer } from "electron";
import { channels, type Channel } from "@autolight/ipc";

// Narrow typed API (T-ARC-02, spec 87): named functions only, no generic
// invoke(channel, payload) surface. Every call validates its request before
// send; every response validates before return. Errors surface as thrown
// Error with the typed code, never as swallowed undefined.

// Plain functions object: contextBridge requires cloneable values, and a
// Proxy traps structured-clone (Electron sandbox: "An object could not be
// cloned"). One named function per channel plus a generic invoke that the
// renderer store calls today (ratchet: migrate to callChannel per task).
const call = async (channel: Channel, request: unknown): Promise<unknown> => {
  const ch = channels[channel];
  const parsed = ch.request.parse(request);
  const raw = await ipcRenderer.invoke(channel, parsed);
  const res = ch.response.parse(raw) as { ok: boolean; error?: { code: string; message: string } };
  if (!res.ok) throw new Error(`${res.error?.code ?? "E_IPC"}: ${res.error?.message ?? channel}`);
  return res;
};
const api: Record<string, (request: unknown) => Promise<unknown>> = {
  invoke: (async (channel: string, request: unknown) => {
    const ch = channels[channel as Channel];
    if (!ch) throw new Error(`unknown-channel: ${channel}`);
    return call(channel as Channel, request);
  }) as (request: unknown) => Promise<unknown>,
};
for (const channel of Object.keys(channels) as Channel[]) {
  api[channel] = async (request: unknown) => call(channel, request);
}

contextBridge.exposeInMainWorld("autolight", api);
