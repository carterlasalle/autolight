/** electron-builder configuration (T-OPS-05, DS-30, ADR-006).
 *
 * Targets: macOS (arm64 + x64, dmg + zip) and Windows (NSIS, x64 + arm64
 * where the native modules build). Unsigned in CI per OD-06; the signed
 * pipeline runs as soon as credentials exist (see README in T-OPS-05
 * evidence for the signing steps).
 *
 * Bundled: uv, pinned CPython (via `uv python install` at first run),
 * the analysis project + uv.lock, FFmpeg (LGPL, recorded in
 * tools/license-check.mjs), and unpacked native addons (govee-toolkit,
 * better-sqlite3-multiple-ciphers). Model weights are NEVER bundled:
 * OD-09 downloads them in Setup with consent.
 */
const config = {
  appId: "com.autolight.app",
  productName: "Autolight",
  // electron-builder downloads platform binaries for one exact release; the
  // devDependency stays ranged (^41) while the shipped version pins here.
  electronVersion: "41.10.6",
  directories: {
    output: "release",
    buildResources: "build",
  },
  files: [
    "dist/**/*",
    "package.json",
    "!node_modules/.cache{,/**}",
  ],
  extraResources: [
    {
      from: "vendor",
      to: "vendor",
      filter: ["**/*", "!**/.gitkeep"],
    },
    {
      from: "../../analysis",
      to: "analysis",
      filter: ["pyproject.toml", "uv.lock", "src/**/*"],
    },
  ],
  asarUnpack: [
    "**/*.node",
    "node_modules/govee-toolkit*/**",
    "node_modules/better-sqlite3-multiple-ciphers/**",
    "node_modules/@julusian/midi*/**",
    "node_modules/@parcel/watcher*/**",
  ],
  mac: {
    category: "public.app-category.music",
    target: [
      { target: "dmg", arch: ["arm64", "x64"] },
      { target: "zip", arch: ["arm64", "x64"] },
    ],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    extendInfo: {
      NSLocalNetworkUsageDescription:
        "Autolight discovers Govee lights on your local network (UDP discovery).",
      NSBonjourServices: ["_SeratoIOSRemote._tcp", "_os2l._tcp"],
      NSBluetoothAlwaysUsageDescription:
        "Autolight uses Bluetooth for Govee BLE control where LAN is unavailable.",
      NSMicrophoneUsageDescription:
        "Autolight can listen to the DJ mix for the live reactive overlay.",
    },
  },
  win: {
    target: [
      { target: "nsis", arch: ["x64", "arm64"] },
    ],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    // Setup explains the Windows firewall prompt for UDP 4001-4003 and the
    // microphone/Bluetooth privacy settings (T-OPS-05, T-SEC-02).
    include: "build/installer.nsh",
  },
  publish: null,
};

module.exports = config;
