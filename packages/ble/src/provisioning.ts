// BLE Wi-Fi provisioning helper (T-BLE-04 slice: frame builders; T-BLE-10 owns the flow).
//
// Sources: WP04 T-BLE-10 which cites govee-toolkit provision_wifi: 33 17 01,
// 3 s wait, chunked A1 11 transfer at 300 ms pacing, 33 17 00. The password
// lives in memory only for the transfer and is never stored unless the owner
// opts into safeStorage. BLE provisioning is plaintext over the air.
import { BLE_PROTYPE } from "./constants.js";
import { encodeBleFrame } from "./commands.js";

/** Provisioning start: 33 17 01. */
export function bleProvisionStart(): Uint8Array {
  return encodeBleFrame(BLE_PROTYPE.WRITE, 0x17, new Uint8Array([0x01]));
}

/** Provisioning stop: 33 17 00. */
export function bleProvisionStop(): Uint8Array {
  return encodeBleFrame(BLE_PROTYPE.WRITE, 0x17, new Uint8Array([0x00]));
}

/** Chunked credential transfer: A1 11 <chunk>. */
export function bleProvisionChunk(chunk: Uint8Array): Uint8Array {
  return encodeBleFrame(0xa1, 0x11, chunk);
}

/** Splits SSID plus password bytes into 17 byte chunks for the A1 11 transfer. */
export function bleProvisionChunks(payload: Uint8Array, chunkLen = 17): Uint8Array[] {
  if (chunkLen <= 0 || chunkLen > 17) throw new RangeError(`provision chunks are 1 to 17 bytes, got ${chunkLen}`);
  const out: Uint8Array[] = [];
  for (let i = 0; i < payload.length; i += chunkLen) out.push(payload.slice(i, i + chunkLen));
  if (out.length === 0) out.push(new Uint8Array(0));
  return out;
}

/** Warn shown before provisioning: the transfer is plaintext over the air. */
export const BLE_PROVISION_PLAINTEXT_WARNING = "BLE provisioning is plaintext over the air";

// ---------------------------------------------------------------------------
// Provisioning flow (T-BLE-10: Setup tool over the frame builders above)
// ---------------------------------------------------------------------------

export interface BleProvisionCredentials {
  ssid: string;
  /** Held in a local only for the transfer, never stored by this module. */
  password: string;
}

export interface BleProvisionTransport {
  write(frame: Uint8Array): Promise<void> | void;
  sleep(ms: number): Promise<void> | void;
}

export interface BleProvisionFlowOptions {
  /** Pacing between A1 11 chunks. Defaults to 300 ms per the toolkit flow. */
  chunkPacingMs?: number;
  /** Wait after 33 17 01 before the chunked transfer. Defaults to 3000 ms. */
  startWaitMs?: number;
  /**
   * Owner opt-in only: called with the password so the caller can keep it in
   * safeStorage. When absent the password is never stored anywhere.
   */
  onPasswordSaved?: (password: string) => void | Promise<void>;
}

export interface BleProvisionResult {
  ssid: string;
  chunksSent: number;
  bytesSent: number;
  passwordStored: boolean;
  /** Plaintext warning the UI shows before the transfer starts. */
  warning: string;
}

/** Wait after 33 17 01 before the chunked transfer (toolkit provision_wifi). */
export const BLE_PROVISION_START_WAIT_MS = 3000;
/** Pacing between A1 11 chunks (toolkit provision_wifi). */
export const BLE_PROVISION_CHUNK_PACING_MS = 300;

/** Credential payload: utf8 ssid, one NUL separator, utf8 password. */
export function bleProvisionPayload(creds: BleProvisionCredentials): Uint8Array {
  if (creds.ssid.length === 0) throw new Error("provisioning needs an SSID");
  const enc = new TextEncoder();
  const ssid = enc.encode(creds.ssid);
  const password = enc.encode(creds.password);
  const out = new Uint8Array(ssid.length + 1 + password.length);
  out.set(ssid, 0);
  out[ssid.length] = 0x00;
  out.set(password, ssid.length + 1);
  return out;
}

/**
 * Moves a light onto another Wi-Fi network: 33 17 01, 3 s wait, chunked
 * A1 11 transfer at 300 ms pacing, 33 17 00. The password lives in a local
 * only for the transfer and is never stored unless the owner opts in through
 * onPasswordSaved (wired to safeStorage outside this package).
 */
export async function provisionBleWifi(
  transport: BleProvisionTransport,
  creds: BleProvisionCredentials,
  opts: BleProvisionFlowOptions = {},
): Promise<BleProvisionResult> {
  const pacing = opts.chunkPacingMs ?? BLE_PROVISION_CHUNK_PACING_MS;
  const startWait = opts.startWaitMs ?? BLE_PROVISION_START_WAIT_MS;
  if (!(pacing > 0)) throw new RangeError(`provision chunk pacing needs a positive ms value, got ${pacing}`);
  if (!(startWait >= 0)) throw new RangeError(`provision start wait needs a non-negative ms value, got ${startWait}`);
  let password = creds.password;
  const payload = bleProvisionPayload({ ssid: creds.ssid, password });
  const chunks = bleProvisionChunks(payload);
  await transport.write(bleProvisionStart());
  await transport.sleep(startWait);
  for (let i = 0; i < chunks.length; i++) {
    await transport.write(bleProvisionChunk(chunks[i] ?? new Uint8Array(0)));
    if (i < chunks.length - 1) await transport.sleep(pacing);
  }
  await transport.write(bleProvisionStop());
  let passwordStored = false;
  if (opts.onPasswordSaved !== undefined) {
    await opts.onPasswordSaved(password);
    passwordStored = true;
  }
  password = "";
  return {
    ssid: creds.ssid,
    chunksSent: chunks.length,
    bytesSent: payload.length,
    passwordStored,
    warning: BLE_PROVISION_PLAINTEXT_WARNING,
  };
}
