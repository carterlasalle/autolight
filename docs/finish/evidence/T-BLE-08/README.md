# T-BLE-08: OS permissions

Closes F-BLE-01, F-BLE-03.

## What was built

- `packages/ble/src/permissions.ts` (new, self-contained, zero imports
  either direction with the BLE stack owned by BleFullStack):
  `blePlatform`, `MACOS_BLUETOOTH_USAGE_DESCRIPTION`,
  `electronBuilderBluetoothBlock` (the `extendInfo` payload for the
  packager config), `bleSetupCopy` (Setup "Allow Bluetooth" step copy
  for darwin, win32, linux, other), `bleDeniedCopy` (denied,
  restricted, powered-off and unsupported fix paths; null when granted
  or unknown).
- macOS fact encoded: Bluetooth access is a TCC privacy permission
  driven by `NSBluetoothAlwaysUsageDescription`; the
  `com.apple.security.device.bluetooth` entitlement only matters for
  sandboxed apps, which AutoLight is not. Windows fact encoded: an
  NSIS-installed Win32 app declares no capabilities, so the copy
  checks adapter state and the Windows Bluetooth privacy setting.
  Linux fact encoded: BlueZ plus group permission, development only.

## What passes today vs what waits

- Passes today: 20-check strip-types smoke (below): platform mapping,
  usage-string presence, per-platform Setup copy, every denied-state
  fix path, null on granted and unknown.
- Waits on the orchestrator: packager config wiring of `extendInfo`
  (packaging slice), Setup step rendering (UI slice), packaged-app
  prompt screenshot (HW runbook HW-BLE-02).

## Proof

- `node --experimental-strip-types` smoke: 20 checks, 0 failures.

## Delete test

Empty the usage string and the usage-string check goes red (packaged
macOS app would prompt with no explanation). Return null from
`bleDeniedCopy` for denied and the denied-fix check goes red (user
sees no fix path). Map win32 to the macOS copy and the Windows
privacy-setting path disappears from the copy check.

## Seams

- The BLE link manager owns adapters and scanning; this module owns
  copy only and never imports a stack file.
- Packager wiring consumes `electronBuilderBluetoothBlock()`; do not
  hardcode a second usage string elsewhere.
