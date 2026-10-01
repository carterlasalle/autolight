// BLE protocol constants (T-BLE-01 to T-BLE-04; WP04 BLE protocol facts).
//
// GATT UUIDs, frame markers and command codes are invariants: they live here
// read-only and Settings shows them read-only. Sources: WP04 (which cites
// govee-toolkit docs/protocol/ble.md, devices/H61A0.yaml, devices/H6008.yaml
// and govee-homeassistant custom_components/govee/api ble files). No value
// here measures the owner's units.

export const BLE_SERVICE_UUID = "00010203-0405-0607-0809-0a0b0c0d1910";
export const BLE_WRITE_UUID = "00010203-0405-0607-0809-0a0b0c0d2b11";
export const BLE_NOTIFY_UUID = "00010203-0405-0607-0809-0a0b0c0d2b10";
export const BLE_VERSION_UUID = "00010203-0405-0607-0809-0a0b0c0d2b12";

/** 20-byte GATT frame length for 0x33/0xAA/0xA1/0xA3 (WP04). */
export const BLE_FRAME_LEN = 20;
/** Payload bytes available between the two header bytes and the XOR byte. */
export const BLE_PAYLOAD_LEN = 17;

/** Frame markers (WP04): write, read, provisioning, chunked, host colour, handshake. */
export const BLE_PROTYPE = {
  WRITE: 0x33,
  READ: 0xaa,
  PROVISION: 0xa1,
  CHUNKED: 0xa3,
  HOST_COLOR: 0xa5,
  HANDSHAKE: 0xe7,
} as const;

/** Write command codes (WP04). */
export const BLE_WRITE_CMD = {
  POWER: 0x01,
  BRIGHTNESS: 0x04,
  COLOR: 0x05,
  INTERPOLATION: 0xa3,
} as const;

/** Colour payload modes under 0x33 0x05 (WP04). */
export const BLE_COLOR_MODE = {
  LEGACY: 0x02,
  SINGLE: 0x0d,
  MASKED: 0x15,
} as const;

/** Masked payload kinds under 0x33 0x05 0x15 (WP04). */
export const BLE_MASKED_KIND = {
  COLOR: 0x01,
  BRIGHTNESS: 0x02,
  PER_ZONE_BRIGHTNESS: 0x03,
} as const;

/** Read command codes (WP04). */
export const BLE_READ_CMD = {
  POWER: 0x01,
  BRIGHTNESS: 0x04,
  SUB_MODE: 0x05,
  EXTRA_06: 0x06,
  EXTRA_07: 0x07,
  SEGMENT_COUNT: 0x0f,
  WIFI_MAC: 0x14,
  HARD_VERSION: 0x20,
  SOFT_VERSION: 0x21,
  IC_COUNT: 0x40,
  GROUP_A5: 0xa5,
  EXTRA_AB: 0xab,
} as const;

/** Host colour channel sub commands (WP04). */
export const BLE_HOST_COLOR = {
  PROBE: 0x90,
  ONE_COLOR: 0x83,
} as const;

/** Minimum short 0xA5 frame: marker, sub command, sum checksum. */
export const BLE_A5_MIN_LEN = 3;

/** Advertisement encoded flag bit (WP04): set means encoded frames only. */
export const BLE_ENCODED_FLAG = 0x40;

/** Config defaults mirrored here so call sites read them, never literals. */
export const BLE_DEFAULTS = {
  /** govee.ble.writeBudgetHzDefault: toolkit H61A0 one-unit value. */
  WRITE_BUDGET_HZ: 100,
  /** govee.ble.writeDrainMsDefault: per-unit wizard value. */
  WRITE_DRAIN_MS: 300,
  /** govee.ble.scanTimeoutMs. */
  SCAN_TIMEOUT_MS: 10000,
} as const;

/** Badge shown while a unit's write budget is still the default (T-BLE-03). */
export const BLE_WRITE_BUDGET_UNMEASURED_BADGE = "unmeasured";
