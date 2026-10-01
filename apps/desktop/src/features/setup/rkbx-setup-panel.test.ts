import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { summarizeRKBXAssistant } from "@autolight/rekordbox-live";
import { RkbxSetupPanel } from "./rkbx-setup-panel.js";

describe("RkbxSetupPanel (T-LIVE-04)", () => {
  it("renders the receiving state with rate, last address, remedy-free copy and the project link", () => {
    const snapshot = summarizeRKBXAssistant({
      configPath: "/Users/owner/rkbx_link",
      configText: "osc_enabled = true\nosc_dest = 127.0.0.1:4460\n",
      installedVersion: "7.2.17",
      platform: "macos",
      packets: { received: 240, updateHz: 120, lastAddress: "/1/time" },
    });
    const html = renderToStaticMarkup(createElement(RkbxSetupPanel, { snapshot }));
    expect(html).toContain("rkbx_link setup steps");
    expect(html).toContain("receiving");
    expect(html).toContain("120.0 Hz");
    expect(html).toContain("/1/time");
    expect(html).toContain("https://github.com/grufkork/rkbx_link");
    expect(html).toContain("sudo");
  });

  it("shows the specific missing step and UNAVAILABLE_ON_THIS_DEVICE when blocked", () => {
    const noPackets = summarizeRKBXAssistant({
      configPath: "/Users/owner/rkbx_link",
      configText: "osc_enabled = true\nosc_dest = 127.0.0.1:4460\n",
      installedVersion: "7.2.17",
      platform: "macos",
      packets: { received: 0, updateHz: 0, lastAddress: null },
    });
    expect(renderToStaticMarkup(createElement(RkbxSetupPanel, { snapshot: noPackets }))).toContain("no-packets");
    const unsupported = summarizeRKBXAssistant({
      configPath: "/Users/owner/rkbx_link",
      configText: "osc_enabled = true\nosc_dest = 127.0.0.1:4460\n",
      installedVersion: "7.2.10.0333",
      platform: "macos",
      packets: { received: 12, updateHz: 60, lastAddress: "/1/time" },
    });
    const html = renderToStaticMarkup(createElement(RkbxSetupPanel, { snapshot: unsupported }));
    expect(html).toContain("UNAVAILABLE_ON_THIS_DEVICE");
    expect(html).toContain("re-sign");
  });
});
