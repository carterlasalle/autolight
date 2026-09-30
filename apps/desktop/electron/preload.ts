import { contextBridge, ipcRenderer } from "electron";
import { channels, type Channel } from "@autolight/ipc";

// Narrow typed API (T-ARC-02, spec 87): named functions only, no generic
// invoke(channel, payload) surface. Every call validates its request before
// send; every response validates before return. Errors surface as thrown
// Error with the typed code, never as swallowed undefined.
type Api = {
  [C in Channel]: (request: import("@autolight/ipc").ChannelRequest<C>) => Promise<unknown>;
};

const api = new Proxy({} as Api, {
  get(_target, channel: string) {
    return async (request: unknown) => {
      const ch = channels[channel as Channel];
      if (!ch) throw new Error(`unknown-channel: ${channel}`);
      const parsed = ch.request.parse(request);
      const raw = await ipcRenderer.invoke(channel, parsed);
      const res = ch.response.parse(raw) as { ok: boolean; error?: { code: string; message: string } };
      if (!res.ok) throw new Error(`${res.error?.code ?? "E_IPC"}: ${res.error?.message ?? channel}`);
      return res;
    };
  },
});

contextBridge.exposeInMainWorld("autolight", api);
