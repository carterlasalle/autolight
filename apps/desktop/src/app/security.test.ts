import { afterEach, describe, expect, it } from "vitest";
// Collected by vitest (src/**/*.test.ts). Imports the built main module
// source directly; asserts the same exports the bundle probe checks.
import {
  decidePermissionFor,
  isAudioWindow,
  isTrustedLocalUrl,
  registerAudioWindow,
  securitySettings,
  unregisterAudioWindow,
} from "../../electron/main.js";

// The audio-window set is module state: every registration here is tracked
// and removed after each test, so no assertion depends on execution order
// and nothing leaks into later suites (batch-46).
const registeredAudioWindows: string[] = [];

function register(url: string): void {
  registerAudioWindow(url);
  registeredAudioWindows.push(url);
}

afterEach(() => {
  for (const url of registeredAudioWindows.splice(0)) unregisterAudioWindow(url);
});

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

// Only these unquoted sources may appear in any directive: the Vite dev
// origin, file:, and the data:/blob: schemes the app itself uses. Everything
// else — including a permissive connect-src target — fails the assertion
// with the directive named (batch-46).
const ALLOWED_SOURCES = new Set(["http://localhost:5173", "ws://localhost:5173", "file:", "data:", "blob:"]);

function assertOnlyLocalSources(directives: string[]): void {
  for (const directive of directives) {
    const [name, ...sources] = directive.split(/\s+/);

    for (const source of sources) {
      if (source.startsWith("'")) continue;
      expect(ALLOWED_SOURCES.has(source), `${name} carries remote source ${source}`).toBe(true);
    }
  }
}

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
    const directives = csp.split(";").map((d) => d.trim()).filter((d) => d.length > 0);

    // Every script-src* directive, not just the first: a second
    // script-src-elem must not slip past a find() (batch-46).
    const scriptDirectives = directives.filter((d) => d.startsWith("script-src"));

    expect(scriptDirectives).toEqual(["script-src 'self'"]);
    expect(csp).not.toContain("unsafe-eval");
    assertOnlyLocalSources(directives);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
  it("relaxes script-src only for the Vite dev server (the React preamble is inline)", () => {
    const scriptOf = (csp: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
    expect(scriptOf(securitySettings("preload.cjs").csp)).toBe("script-src 'self'");
    expect(scriptOf(securitySettings("preload.cjs", true).csp)).toBe("script-src 'self' 'unsafe-inline'");
    // The relaxation must not leak any other directive, and the dev CSP
    // still carries only local sources.
    const dev = securitySettings("preload.cjs", true).csp;
    expect(dev).toContain("default-src 'none'");
    expect(dev).toContain("object-src 'none'");
    expect(dev).not.toContain("unsafe-eval");
    assertOnlyLocalSources(dev.split(";").map((d) => d.trim()).filter((d) => d.length > 0));
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
    register("file:///audio.html");
    expect(isAudioWindow("file:///audio.html")).toBe(true);
    expect(isAudioWindow("https://evil.example/")).toBe(false);
  });

  it("decides permissions by rule: media to the audio window, midi by identity", () => {
    // The observable enforcement behind the settings data: deleting the
    // rule and calling the handler directly cannot both pass (batch-46).
    register("file:///audio.html");
    // Media: only the registered audio window, from a local origin.
    expect(decidePermissionFor("file:///audio.html", "media", false)).toBe(true);
    expect(decidePermissionFor("file:///index.html", "media", true)).toBe(false);
    expect(decidePermissionFor("https://evil.example/", "media", true)).toBe(false);
    // MIDI: by window identity (the main window) or the audio window, never
    // a mere local URL.
    expect(decidePermissionFor("file:///index.html", "midi", true)).toBe(true);
    expect(decidePermissionFor("file:///index.html", "midi", false)).toBe(false);
    expect(decidePermissionFor("file:///audio.html", "midiSysex", false)).toBe(true);
    expect(decidePermissionFor("https://evil.example/", "midi", true)).toBe(false);
    // Anything else: denied.
    expect(decidePermissionFor("file:///index.html", "geolocation", true)).toBe(false);
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
