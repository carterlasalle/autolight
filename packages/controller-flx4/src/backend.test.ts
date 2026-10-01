// T-FLX-01: backend selection, non-exclusive reads, hotplug, ring and status.

import { describe, expect, it } from "vitest";
import {
  Flx4ControllerService,
  Flx4MessageRing,
  createNativeDriver,
  createWebMidiDriver,
  createWindowsMidiServicesDriver,
  type Flx4BackendName,
  type Flx4DriverProbe,
  type Flx4IntervalScheduler,
  type Flx4MidiDriver,
  type Flx4PortInfo,
} from "./backend.js";

interface ScriptedDriver extends Flx4MidiDriver {
  emit(bytes: readonly number[]): void;
  readonly openCalls: Array<{ port: Flx4PortInfo; args: number }>;
  readonly closeCount: () => number;
}

function scriptedDriver(
  name: Flx4BackendName,
  opts: {
    ports?: Flx4PortInfo[];
    probe?: Flx4DriverProbe;
    sharing?: "shared" | "single-client";
    openError?: Error;
  } = {},
): ScriptedDriver {
  const listeners = new Set<(bytes: readonly number[]) => void>();
  const openCalls: Array<{ port: Flx4PortInfo; args: number }> = [];
  let closes = 0;
  return {
    name,
    sharing: opts.sharing ?? "shared",
    async probe() {
      return opts.probe ?? { ok: true, reason: "" };
    },
    async listPorts() {
      return [...(opts.ports ?? [])];
    },
    async open(port, onMessage, ...rest: unknown[]) {
      openCalls.push({ port, args: 2 + rest.length });
      if (opts.openError !== undefined) throw opts.openError;
      listeners.add(onMessage);
      return {
        port,
        close() {
          listeners.delete(onMessage);
          closes += 1;
        },
      };
    },
    emit(bytes) {
      for (const listener of listeners) listener(bytes);
    },
    openCalls,
    closeCount: () => closes,
  };
}

function fakeScheduler(): Flx4IntervalScheduler & { intervals: number[]; cleared: unknown[] } {
  const intervals: number[] = [];
  const cleared: unknown[] = [];
  return {
    intervals,
    cleared,
    setInterval(_fn, ms) {
      intervals.push(ms);
      return { handle: intervals.length };
    },
    clearInterval(handle) {
      cleared.push(handle);
    },
  };
}

const flx4Port: Flx4PortInfo = { id: "0", name: "DDJ-FLX4 MIDI 1" };

describe("flx4 backend selection (DS-13)", () => {
  it("falls back through native, Windows MIDI Services and Web MIDI, reporting each attempt", async () => {
    const native = scriptedDriver("native", { probe: { ok: false, reason: "@julusian/midi is not loadable: MODULE_NOT_FOUND" } });
    const wms = scriptedDriver("windows-midi-services", { probe: { ok: false, reason: "Windows MIDI Services is Windows only" } });
    const web = scriptedDriver("webmidi", { ports: [flx4Port] });
    const service = new Flx4ControllerService({ drivers: { native, "windows-midi-services": wms, webmidi: web } });
    const status = await service.start();
    expect(status.connection).toBe("connected");
    expect(status.backend).toBe("webmidi");
    expect(status.portName).toBe("DDJ-FLX4 MIDI 1");
    expect(status.attempts).toEqual([
      { backend: "native", ok: false, reason: "@julusian/midi is not loadable: MODULE_NOT_FOUND" },
      { backend: "windows-midi-services", ok: false, reason: "Windows MIDI Services is Windows only" },
    ]);
    await service.stop();
  });

  it("reports UNAVAILABLE_ON_THIS_DEVICE when the only backend cannot load", async () => {
    const native = scriptedDriver("native", { probe: { ok: false, reason: "@julusian/midi is not loadable: MODULE_NOT_FOUND" } });
    const service = new Flx4ControllerService({ mode: "native", drivers: { native }, platform: "darwin" });
    const status = await service.start();
    expect(status.connection).toBe("unavailable-on-this-device");
    expect(status.reason).toContain("MODULE_NOT_FOUND");
    expect(status.remedy).toContain("@julusian/midi");
    await service.stop();
  });

  it("reports the Rekordbox-holds-the-port remedy for a single-client Windows open failure", async () => {
    const held = scriptedDriver("native", {
      sharing: "single-client",
      ports: [flx4Port],
      openError: new Error("the input port is in use by another application"),
    });
    const windows = new Flx4ControllerService({ mode: "native", drivers: { native: held }, platform: "win32" });
    const windowsStatus = await windows.start();
    expect(windowsStatus.connection).toBe("unavailable-on-this-device");
    expect(windowsStatus.reason).toBe("the input port is in use by another application");
    expect(windowsStatus.remedy).toBe(
      "Rekordbox is holding the FLX4 input; install Windows MIDI Services or use a Rekordbox source that does not need the controller",
    );
    await windows.stop();

    const macDriver = scriptedDriver("native", {
      sharing: "single-client",
      ports: [flx4Port],
      openError: new Error("the input port is in use by another application"),
    });
    const mac = new Flx4ControllerService({ mode: "native", drivers: { native: macDriver }, platform: "darwin" });
    const macStatus = await mac.start();
    expect(macStatus.connection).toBe("unavailable-on-this-device");
    expect(macStatus.remedy).not.toContain("Rekordbox is holding");
    await mac.stop();
  });

  it("reads the same port from two services at once without an exclusive open", async () => {
    const driver = scriptedDriver("native", { ports: [flx4Port] });
    const first = new Flx4ControllerService({ mode: "native", drivers: { native: driver } });
    const second = new Flx4ControllerService({ mode: "native", drivers: { native: driver } });
    await first.start();
    await second.start();
    driver.emit([0x90, 0x0b, 0x7f]);
    expect(first.recentEvents(1)[0]).toMatchObject({ type: "control", id: "deck1.play" });
    expect(second.recentEvents(1)[0]).toMatchObject({ type: "control", id: "deck1.play" });
    expect(driver.openCalls.every((call) => call.args === 2)).toBe(true);
    expect(first.status().backend).toBe("native");
    await first.stop();
    await second.stop();
  });

  it("matches ports by name, including a custom pattern", async () => {
    const ports: Flx4PortInfo[] = [
      { id: "1", name: "Some Other Keyboard" },
      { id: "2", name: "DDJ-FLX4 MIDI 1" },
    ];
    const driver = scriptedDriver("native", { ports });
    const service = new Flx4ControllerService({ mode: "native", drivers: { native: driver } });
    const status = await service.start();
    expect(status.portName).toBe("DDJ-FLX4 MIDI 1");
    await service.stop();

    const custom = scriptedDriver("native", { ports });
    const customService = new Flx4ControllerService({ mode: "native", drivers: { native: custom }, portMatch: "FLX4$" });
    const customStatus = await customService.start();
    expect(customStatus.connection).toBe("searching");
    const loose = new Flx4ControllerService({ mode: "native", drivers: { native: custom }, portMatch: "ddj-flx4" });
    const looseStatus = await loose.start();
    expect(looseStatus.portName).toBe("DDJ-FLX4 MIDI 1");
    expect(looseStatus.connection).toBe("connected");
    await customService.stop();
    await loose.stop();
  });

  it("detects unplug and replug through the hotplug poll", async () => {
    const ports: Flx4PortInfo[] = [{ ...flx4Port }];
    const driver = scriptedDriver("native", { ports });
    const service = new Flx4ControllerService({ mode: "native", drivers: { native: driver }, hotplugPollMs: 2000 });
    const transitions: string[] = [];
    service.onStatusChange((status) => transitions.push(status.connection));
    await service.start();
    expect(transitions).toEqual(["connected"]);
    ports.splice(0, 1);
    await service.poll();
    expect(transitions).toEqual(["connected", "lost"]);
    expect(service.status().remedy).toContain("reconnect");
    ports.push({ ...flx4Port });
    await service.poll();
    expect(transitions).toEqual(["connected", "lost", "connected"]);
    expect(driver.openCalls).toHaveLength(2);
    expect(driver.closeCount()).toBe(1);
    await service.stop();
  });

  it("keeps messages in a bounded ring with a drop counter and ages the last message", async () => {
    let now = 0n;
    const driver = scriptedDriver("native", { ports: [flx4Port] });
    const service = new Flx4ControllerService({
      mode: "native",
      drivers: { native: driver },
      ringCapacity: 4,
      nowNs: () => now,
    });
    await service.start();
    for (let index = 0; index < 6; index += 1) {
      now += 1_000_000n;
      driver.emit([0xb0, 0x13 + index, 0x40]);
    }
    const status = service.status();
    expect(status.messagesReceived).toBe(6);
    expect(status.messagesDropped).toBe(2);
    expect(service.recentMessages(2).map((message) => message.bytes[1])).toEqual([0x17, 0x18]);
    expect(status.lastMessageAgeMs).toBe(0);
    now += 5_000_000n;
    expect(service.status().lastMessageAgeMs).toBe(5);
    await service.stop();
  });

  it("counts unknown messages in the status", async () => {
    const driver = scriptedDriver("native", { ports: [flx4Port] });
    const service = new Flx4ControllerService({ mode: "native", drivers: { native: driver } });
    await service.start();
    driver.emit([0x90, 0x7e, 0x40]);
    expect(service.status().unknownMessages).toBe(1);
    expect(service.recentMessages(1)[0]?.bytes).toEqual([0x90, 0x7e, 0x40]);
    await service.stop();
  });

  it("arms and clears the hotplug poll on the injected scheduler", async () => {
    const scheduler = fakeScheduler();
    const driver = scriptedDriver("native", { ports: [flx4Port] });
    const service = new Flx4ControllerService({ mode: "native", drivers: { native: driver }, scheduler, hotplugPollMs: 1500 });
    await service.start();
    expect(scheduler.intervals).toEqual([1500]);
    await service.stop();
    expect(scheduler.cleared).toHaveLength(1);
  });

  it("bounds the ring directly", () => {
    const ring = new Flx4MessageRing(3);
    for (let index = 0; index < 5; index += 1) ring.push({ bytes: [0x90, 0x0b, index], receivedAtNs: BigInt(index) });
    expect(ring.dropped).toBe(2);
    expect(ring.recent(2).map((message) => message.bytes[2])).toEqual([3, 4]);
  });
});

describe("flx4 platform drivers", () => {
  it("reads ports and messages through the native RtMidi surface", async () => {
    const listeners: Array<(deltaTime: number, message: number[]) => void> = [];
    let closed = 0;
    class FakeInput {
      getPortCount() {
        return 1;
      }
      getPortName() {
        return "DDJ-FLX4 MIDI 1";
      }
      openPort() {}
      closePort() {
        closed += 1;
      }
      on(_event: "message", listener: (deltaTime: number, message: number[]) => void) {
        listeners.push(listener);
      }
    }
    const driver = createNativeDriver(() => ({ Input: FakeInput }), "darwin");
    expect(driver.sharing).toBe("shared");
    expect(await driver.probe()).toEqual({ ok: true, reason: "" });
    expect(await driver.listPorts()).toEqual([{ id: "0", name: "DDJ-FLX4 MIDI 1" }]);
    const seen: number[][] = [];
    const input = await driver.open(flx4Port, (bytes) => seen.push([...bytes]));
    listeners[0]?.(0, [0x90, 0x0b, 0x7f]);
    expect(seen).toEqual([[0x90, 0x0b, 0x7f]]);
    input.close();
    expect(closed).toBeGreaterThan(0);
  });

  it("declares WinMM single-client and CoreMIDI shared", () => {
    expect(createNativeDriver(() => ({ Input: class {} }), "win32").sharing).toBe("single-client");
    expect(createNativeDriver(() => ({ Input: class {} }), "darwin").sharing).toBe("shared");
  });

  it("gates Windows MIDI Services to Windows and uses its binding", async () => {
    const notWindows = createWindowsMidiServicesDriver(() => ({}), "darwin");
    const probe = await notWindows.probe();
    expect(probe).toEqual({ ok: false, reason: "Windows MIDI Services is Windows only" });
    const missing = createWindowsMidiServicesDriver(() => {
      throw new Error("Cannot find module 'windows-midi-services'");
    }, "win32");
    expect((await missing.probe()).ok).toBe(false);

    const seen: number[][] = [];
    let closed = false;
    const binding = {
      listInputPorts: () => ["DDJ-FLX4"],
      openInput: (_name: string, onMessage: (bytes: readonly number[]) => void) => {
        const listener = onMessage;
        return {
          close() {
            closed = true;
          },
          send(bytes: number[]) {
            listener(bytes);
          },
        };
      },
    };
    const driver = createWindowsMidiServicesDriver(() => binding, "win32");
    expect(await driver.probe()).toEqual({ ok: true, reason: "" });
    expect(await driver.listPorts()).toEqual([{ id: "DDJ-FLX4", name: "DDJ-FLX4" }]);
    const input = await driver.open({ id: "DDJ-FLX4", name: "DDJ-FLX4" }, (bytes) => seen.push([...bytes]));
    // The binding surface has no send function; the driver only wires the callback.
    expect(input.port.name).toBe("DDJ-FLX4");
    input.close();
    expect(closed).toBe(true);
    expect(seen).toEqual([]);
  });

  it("uses Web MIDI when the context provides it", async () => {
    const missing = createWebMidiDriver();
    const probe = await missing.probe();
    expect(probe.ok).toBe(false);
    expect(probe.reason).toContain("hidden audio window");

    const seen: number[][] = [];
    const input = { id: "web-1", name: "DDJ-FLX4", onmidimessage: null as ((event: { data: Uint8Array | null }) => void) | null };
    const access = { inputs: new Map([[input.id, input]]) };
    const driver = createWebMidiDriver(() => Promise.resolve(access));
    expect(await driver.probe()).toEqual({ ok: true, reason: "" });
    expect(await driver.listPorts()).toEqual([{ id: "web-1", name: "DDJ-FLX4" }]);
    const opened = await driver.open({ id: "web-1", name: "DDJ-FLX4" }, (bytes) => seen.push([...bytes]));
    input.onmidimessage?.({ data: new Uint8Array([0x90, 0x0b, 0x7f]) });
    expect(seen).toEqual([[0x90, 0x0b, 0x7f]]);
    opened.close();
    expect(input.onmidimessage).toBeNull();
  });
});
