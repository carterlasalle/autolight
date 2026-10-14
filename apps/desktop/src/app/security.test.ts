import { describe, expect, it } from "vitest";
// Collected by vitest (src/**/*.test.ts). Imports the built main module
// source directly; asserts the same exports the bundle probe checks.
import { securitySettings, registerAudioWindow, isAudioWindow, isTrustedLocalUrl } from "../../electron/main.js";

// T-SEC-03 Electron security checklist: asserts every hardening setting from
// the built main module exports. If main.ts stops consuming any field, add
// the matching assertion here (or delete both together); the delete test is:
// remove a guard in main.ts and this file goes red.
//
// NOTE: vitest collects src/** only, so this file is a declared checklist.
// The orchestrator runs it against the built bundle: after
// `node scripts/build-main.mjs`, load dist/electron/main.cjs with electron
// stubbed and boot() skipped, then assert the same expectations below
// against securitySettings(). P-132/P-133/P-87 plus this delete test are the
// acceptance probes named in docs/finish/evidence/T-SEC-03/README.md.

describe("T-SEC-03 security checklist", () => {
  it("uses sandbox, context isolation, no node integration, web security", () => {
    const s = securitySettings("preload.cjs");
    expect(s.webPreferences.preload).toBe("preload.cjs");
    expect(s.webPreferences.contextIsolation).toBe(true);
    expect(s.webPreferences.sandbox).toBe(true);
    expect(s.webPreferences.nodeIntegration).toBe(false);
    expect(s.webPreferences.webSecurity).toBe(true);
  });
  it("ships a strict CSP with no remote scripts and no eval", () => {
    const { csp } = securitySettings("preload.cjs");
    const script = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
    expect(script).toBe("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("https:");

    for (const dir of csp.split(";").map((d) => d.trim())) {
      if (dir.startsWith("connect-src")) continue;
      expect(dir).not.toContain("http:");
    }

    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
  it("relaxes script-src only for the Vite dev server (the React preamble is inline)", () => {
    const scriptOf = (csp: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
    expect(scriptOf(securitySettings("preload.cjs").csp)).toBe("script-src 'self'");
    expect(scriptOf(securitySettings("preload.cjs", true).csp)).toBe("script-src 'self' 'unsafe-inline'");
    // The relaxation must not leak any other directive.
    const dev = securitySettings("preload.cjs", true).csp;
    expect(dev).toContain("default-src 'none'");
    expect(dev).toContain("object-src 'none'");
    expect(dev).not.toContain("unsafe-eval");
  });

  it("navigates only to app origins and never opens new windows", () => {
    const s = securitySettings("preload.cjs");
    expect(s.allowedNavigation).toEqual(["file://", "http://localhost:5173"]);
    expect(s.allowNewWindow).toBe(false);
  });

  it("grants media only to the registered audio window, midi locally", () => {
    const s = securitySettings("preload.cjs");
    expect(s.permissions.audioCaptureOrigins).toEqual(["file://", "http://localhost:5173"]);
    expect(s.permissions.midiOrigins).toEqual(["file://", "http://localhost:5173"]);
    // Media is denied everywhere until T-AUD-01 registers the audio window.
    expect(isAudioWindow("file:///index.html")).toBe(false);
    registerAudioWindow("file:///audio.html");
    expect(isAudioWindow("file:///audio.html")).toBe(true);
    expect(isAudioWindow("https://evil.example/")).toBe(false);
  });

  it("matches local URLs by exact origin, never by prefix", () => {
    // The origin rule the ipc-router sender check and every window-level
    // guard share: the dev origin and file:// pass, prefix lookalikes and
    // the rest of the web do not.
    expect(isTrustedLocalUrl("http://localhost:5173/")).toBe(true);
    expect(isTrustedLocalUrl("http://localhost:5173/index.html?x=1#y")).toBe(true);
    expect(isTrustedLocalUrl("http://localhost:5173.evil.com/")).toBe(false);
    expect(isTrustedLocalUrl("http://localhost:5173@evil.com/")).toBe(false);
    expect(isTrustedLocalUrl("http://localhost:5174/")).toBe(false);
    expect(isTrustedLocalUrl("file:///index.html")).toBe(true);
    expect(isTrustedLocalUrl("https://evil.example/")).toBe(false);
    expect(isTrustedLocalUrl("")).toBe(false);
    // Devtools pages are a navigation allowance only, never a script one.
    expect(isTrustedLocalUrl("devtools://devtools/bundled/inspector.html")).toBe(false);
    expect(isTrustedLocalUrl("devtools://devtools/bundled/inspector.html", { allowDevtools: true })).toBe(true);
  });
});
