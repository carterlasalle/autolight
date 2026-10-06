import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RKBX_LINK_PROJECT_URL,
  RKBX_OS_NOTES,
  RKBX_RESIGN_COPY,
  RKBX_SUDO_COPY,
  assistantCapability,
  isRKBXVersionSupported,
  sampleFromProvider,
  summarizeRKBXAssistant,
} from "./setup-assistant.js";
import { buildRkbxDatagrams, RkbxOscProvider } from "./rkbx-osc.js";
import { checkRkbxSetup } from "./follow.js";
import { decodeOscDatagram } from "./osc.js";

const dir = dirname(fileURLToPath(import.meta.url));

function baseInput() {
  return {
    configPath: "/Users/owner/rkbx_link",
    configText: "osc_enabled = true\nosc_dest = 127.0.0.1:4460\n",
    installedVersion: "7.2.17",
    platform: "macos" as const,
    packets: { received: 240, updateHz: 120, lastAddress: "/1/time" },
  };
}

describe("rkbx_link setup assistant (T-LIVE-04)", () => {
  it("walks to receiving with a supported install, enabled OSC, matching port and packets", () => {
    const snapshot = summarizeRKBXAssistant(baseInput());
    expect(snapshot.configFound).toBe(true);
    expect(snapshot.oscEnabled).toBe(true);
    expect(snapshot.destination).toBe("127.0.0.1:4460");
    expect(snapshot.report.state).toBe("receiving");
    expect(snapshot.capability).toBe("PASS");
  });

  it("walks to receiving from a real OSC sim stream, not hand-set counters", () => {
    let now = 1_000n * 1_000_000_000n;
    const provider = new RkbxOscProvider({ now: () => now, bind: null });
    const datagrams = buildRkbxDatagrams({
      deck: 1, fromSeconds: 0, bpm: 128, hz: 60, durationMs: 500,
      steps: [{ atMs: 0, action: "play" }],
    });
    for (const datagram of datagrams) {
      now += 16n * 1_000_000n;
      const decoded = decodeOscDatagram(datagram.bytes);
      expect(decoded.malformed).toHaveLength(0);
      provider.ingestDatagram(datagram.bytes);
    }
    const snapshot = summarizeRKBXAssistant({
      ...baseInput(),
      packets: sampleFromProvider(provider.getStatus(), provider.getStats(), provider.lastSeenAddress),
    });
    expect(snapshot.packets.received).toBeGreaterThan(0);
    expect(snapshot.packets.lastAddress).toBe("/1/time");
    expect(snapshot.report.state).toBe("receiving");
    expect(snapshot.capability).toBe("PASS");
  });

  it("names the exact missing step when nothing arrives", () => {
    const snapshot = summarizeRKBXAssistant({
      ...baseInput(),
      packets: { received: 0, updateHz: 0, lastAddress: null },
    });
    expect(snapshot.report.state).toBe("no-packets");
    expect(snapshot.report.remedy).toContain("no OSC packets");
    expect(snapshot.capability).toBe("MISSING");
  });

  it("reports not-installed when no folder is selected or the folder has no config", () => {
    expect(summarizeRKBXAssistant({ ...baseInput(), configPath: "  " }).report.state).toBe("not-installed");
    expect(summarizeRKBXAssistant({ ...baseInput(), configText: null }).report.state).toBe("not-installed");
  });

  it("reports osc-disabled and wrong-destination for a misconfigured sidecar", () => {
    const disabled = summarizeRKBXAssistant({
      ...baseInput(),
      configText: "osc_enabled = false\nosc_dest = 127.0.0.1:4460\n",
    });
    expect(disabled.report.state).toBe("osc-disabled");
    const wrongPort = summarizeRKBXAssistant({
      ...baseInput(),
      configText: "osc_enabled = true\nosc_dest = 127.0.0.1:9999\n",
    });
    expect(wrongPort.report.state).toBe("wrong-destination");
    expect(wrongPort.report.remedy).toContain("127.0.0.1:4460");
  });

  it("reports UNAVAILABLE_ON_THIS_DEVICE for an unsupported Rekordbox version with the remedy", () => {
    const snapshot = summarizeRKBXAssistant({ ...baseInput(), installedVersion: "7.2.10.0333" });
    expect(snapshot.report.state).toBe("unsupported-version");
    expect(snapshot.capability).toBe("UNAVAILABLE_ON_THIS_DEVICE");
    expect(snapshot.report.remedy).toContain("re-sign");
    expect(snapshot.report.remedy).toContain("sudo");
  });

  it("matches build tags to their support entry and separates macOS from Windows", () => {
    expect(isRKBXVersionSupported("7.2.10.0333", "windows")).toBe(true);
    expect(isRKBXVersionSupported("7.2.10.0333", "macos")).toBe(false);
    expect(isRKBXVersionSupported("7.2.17", "macos")).toBe(true);
    expect(isRKBXVersionSupported("", "macos")).toBe(false);
    expect(RKBX_OS_NOTES.macos).toContain("7.2.10");
    expect(RKBX_OS_NOTES.windows).toContain("paid");
  });

  it("explains re-sign and sudo in plain words with the project link", () => {
    expect(RKBX_RESIGN_COPY).toContain("re-sign");
    expect(RKBX_SUDO_COPY).toContain("sudo");
    expect(RKBX_SUDO_COPY).toContain("never");
    expect(RKBX_LINK_PROJECT_URL).toBe("https://github.com/grufkork/rkbx_link");
  });

  it("maps every setup state to the capability vocabulary", () => {
    expect(assistantCapability(checkRkbxSetup({
      configFound: false,
      config: { lines: [], oscEnabled: null, destination: null },
      expectedDestination: "127.0.0.1:4460",
      installedRekordboxVersion: "x",
      supportedVersions: ["y"],
      packetsReceived: 0,
      lastAddress: null,
    }))).toBe("MISSING");
  });

  it("offers no privileged action from the assistant code", () => {
    // Tokens name process execution, download, and signing primitives, not
    // words. The re-sign and sudo consequences are explained in copy (checked
    // above), and RegExp.exec is the config parser, so neither is flagged.
    for (const file of ["setup-assistant.ts", "rkbx-osc.ts"]) {
      const source = readFileSync(join(dir, file), "utf8");
      for (const token of ["child_process", "spawnSync", "spawn(", "execFile", "codesign", "curl ", "wget ", "fetch(", "https.get", "createWriteStream"]) {
        expect(source, `${file} contains ${token}`).not.toContain(token);
      }
    }
  });
});
