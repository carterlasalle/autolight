// OS Bluetooth permission flows (T-BLE-08, closes F-BLE-01 and F-BLE-03).
//
// This module is UI copy plus fix paths only: it never touches a BLE stack,
// never imports one, and no stack file imports it. The link manager owns
// adapters and scanning; Setup and Diagnostics render these strings.
//
// macOS note (from the work package): Bluetooth access is a TCC privacy
// permission driven by the NSBluetoothAlwaysUsageDescription usage string.
// The com.apple.security.device.bluetooth entitlement only matters for
// sandboxed apps, which AutoLight is not. electron-builder supplies the
// usage string through extendInfo.

export type BlePermissionState =
  | "unknown"
  | "granted"
  | "denied"
  | "restricted"
  | "powered-off"
  | "unsupported";

export type BlePlatform = "darwin" | "win32" | "linux" | "other";

export function blePlatform(platform: string = process.platform): BlePlatform {
  if (platform === "darwin") return "darwin";
  if (platform === "win32") return "win32";
  if (platform === "linux") return "linux";
  return "other";
}

export const MACOS_BLUETOOTH_USAGE_DESCRIPTION =
  "AutoLight uses Bluetooth to find and control your Govee lights directly.";

export function electronBuilderBluetoothBlock(): {
  extendInfo: { NSBluetoothAlwaysUsageDescription: string };
} {
  return {
    extendInfo: {
      NSBluetoothAlwaysUsageDescription: MACOS_BLUETOOTH_USAGE_DESCRIPTION,
    },
  };
}

export function bleSetupCopy(platform: BlePlatform): {
  title: string;
  body: string;
  fix: string;
} {
  if (platform === "darwin") {
    return {
      title: "Allow Bluetooth",
      body: "AutoLight scans for Govee lights over Bluetooth. macOS asks once; allow it to keep discovery working.",
      fix: "If you said no: System Settings > Privacy and Security > Bluetooth, turn AutoLight on, then rescan.",
    };
  }
  if (platform === "win32") {
    return {
      title: "Check Bluetooth access",
      body: "Windows shows no install-time prompt for this app. Turn Bluetooth on and allow apps to use it.",
      fix: "Settings > Bluetooth and devices: turn Bluetooth on. Then Settings > Privacy and security > Bluetooth: allow apps. If the adapter is off there is no scan; fix path: Device Manager > Bluetooth > enable the adapter.",
    };
  }
  if (platform === "linux") {
    return {
      title: "BlueZ and group access (development only)",
      body: "Linux builds are for development. BlueZ must run and your user must reach the adapter.",
      fix: "Check bluetoothctl shows the controller powered on. Add your user to the bluetooth group or run the documented udev rule, then restart the session.",
    };
  }
  return {
    title: "Bluetooth unavailable",
    body: "This platform has no BLE path; use LAN discovery instead.",
    fix: "Use LAN discovery on the same subnet as the lights.",
  };
}

export function bleDeniedCopy(state: BlePermissionState, platform: BlePlatform): string | null {
  if (state === "granted" || state === "unknown") return null;
  const setup = bleSetupCopy(platform);
  if (state === "powered-off") {
    return `Bluetooth is off. Turn it on, then rescan. ${setup.fix}`;
  }
  if (state === "unsupported") {
    return "This machine has no Bluetooth adapter. Use LAN discovery instead.";
  }
  return setup.fix;
}
