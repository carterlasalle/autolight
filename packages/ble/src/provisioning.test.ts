// T-BLE-10: BLE Wi-Fi provisioning helper (Setup tool over BLE).
//
// Proves the toolkit provision_wifi flow: 33 17 01, 3 s wait, chunked A1 11
// transfer at 300 ms pacing, 33 17 00. The password lives in a local only
// for the transfer and is never stored unless the owner opts in through
// onPasswordSaved (wired to safeStorage outside this package). The UI shows
// the plaintext warning before the transfer starts.
import { describe, expect, it } from "vitest";
import { decodeBleFrame } from "./commands.js";
import {
  BLE_PROVISION_CHUNK_PACING_MS,
  BLE_PROVISION_PLAINTEXT_WARNING,
  BLE_PROVISION_START_WAIT_MS,
  bleProvisionPayload,
  provisionBleWifi,
  type BleProvisionTransport,
} from "./provisioning.js";
import { SimPeripheral, simProvisionBytes } from "./sim.js";

function scriptedTransport(peripheral: SimPeripheral): { transport: BleProvisionTransport; sleeps: number[]; frames: Uint8Array[] } {
  const sleeps: number[] = [];
  const frames: Uint8Array[] = [];
  let t = 10000;
  return {
    sleeps,
    frames,
    transport: {
      write(frame: Uint8Array): void {
        frames.push(frame.slice());
        t += 300;
        peripheral.handleWrite(frame, t);
      },
      sleep(ms: number): void {
        sleeps.push(ms);
      },
    },
  };
}

describe("ble wifi provisioning (T-BLE-10)", () => {
  it("encodes the credential payload as utf8 ssid, NUL, utf8 password", () => {
    const payload = bleProvisionPayload({ ssid: "VenueRouter", password: "s3cret" });
    expect([...payload]).toEqual([...Buffer.from("VenueRouter\0s3cret", "utf8")]);
    expect(() => bleProvisionPayload({ ssid: "", password: "x" })).toThrow(/SSID/);
  });

  it("runs start, 3 s wait, paced chunks, stop against the sim", async () => {
    const peripheral = new SimPeripheral({ address: "AA:BB:CC:DD:EE:A1", zones: 2, budgetHz: null });
    const scripted = scriptedTransport(peripheral);
    const result = await provisionBleWifi(scripted.transport, { ssid: "VenueRouter", password: "s3cret" });
    expect(result.ssid).toBe("VenueRouter");
    expect(result.passwordStored).toBe(false);
    expect(result.warning).toBe(BLE_PROVISION_PLAINTEXT_WARNING);
    const expectedPayload = bleProvisionPayload({ ssid: "VenueRouter", password: "s3cret" });
    expect(result.bytesSent).toBe(expectedPayload.length);
    expect(result.chunksSent).toBe(Math.ceil(expectedPayload.length / 17));
    const first = decodeBleFrame(scripted.frames[0] ?? new Uint8Array(0));
    expect(first?.proType).toBe(0x33);
    expect(first?.cmd).toBe(0x17);
    expect(first?.payload[0]).toBe(0x01);
    const last = decodeBleFrame(scripted.frames[scripted.frames.length - 1] ?? new Uint8Array(0));
    expect(last?.cmd).toBe(0x17);
    expect(last?.payload[0]).toBe(0x00);
    const chunks = scripted.frames.slice(1, -1);
    expect(chunks.map((f) => decodeBleFrame(f)?.proType)).toEqual(chunks.map(() => 0xa1));
    expect(chunks.map((f) => decodeBleFrame(f)?.cmd)).toEqual(chunks.map(() => 0x11));
    expect(scripted.sleeps[0]).toBe(BLE_PROVISION_START_WAIT_MS);
    expect(scripted.sleeps.slice(1).every((s) => s === BLE_PROVISION_CHUNK_PACING_MS)).toBe(true);
    const received = simProvisionBytes(peripheral);
    const trimmed = received.slice(0, expectedPayload.length);
    expect([...trimmed]).toEqual([...expectedPayload]);
    expect(peripheral.provisionComplete).toBe(true);
  });

  it("stores the password only on explicit owner opt-in", async () => {
    const peripheral = new SimPeripheral({ address: "AA:BB:CC:DD:EE:A2", zones: 2, budgetHz: null });
    const scripted = scriptedTransport(peripheral);
    let saved: string | null = null;
    const result = await provisionBleWifi(
      scripted.transport,
      { ssid: "VenueRouter", password: "s3cret" },
      { onPasswordSaved: (password: string) => { saved = password; } },
    );
    expect(result.passwordStored).toBe(true);
    expect(saved).toBe("s3cret");
    await expect(provisionBleWifi(scripted.transport, { ssid: "x", password: "y" }, { chunkPacingMs: 0 })).rejects.toThrow(/pacing/);
  });
});
