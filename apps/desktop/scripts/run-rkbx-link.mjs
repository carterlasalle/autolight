#!/usr/bin/env node
// rkbx_link sidecar runner: stages everything short of execution.
//
// The app never runs this itself (no child_process anywhere in the bundle).
// The owner runs it by hand in a terminal:
//
//   node apps/desktop/scripts/run-rkbx-link.mjs          # stage + verify
//   node apps/desktop/scripts/run-rkbx-link.mjs --dry-run # print, don't run
//
// What it does, in order:
//   1. Checks ~/rkbx_link/rkbx_link and data/offsets-macos exist.
//   2. Greps the offsets file for the Rekordbox version in use and warns
//      honestly when there is no section for it (e.g. 7.2.19).
//   3. Prints the sudo command the owner pastes into a terminal, tailing the
//      log at <rkbx_link>/run.log.
//   4. Listens on 127.0.0.1:4460 for up to 10 s and reports whether OSC
//      packets arrive.
//
// --dry-run prints the exact commands without touching the network or disk.
import { createSocket } from "node:dgram";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SIDECAR_DIR = join(homedir(), "rkbx_link");
const BINARY = join(SIDECAR_DIR, "rkbx_link");
const OFFSETS = join(SIDECAR_DIR, "data", "offsets-macos");
const LOG = join(SIDECAR_DIR, "run.log");
const OSC_HOST = "127.0.0.1";
const OSC_PORT = 4460;
const WAIT_MS = 10_000;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const rekordboxVersion = process.env.RKBX_REKORDBOX_VERSION ?? "7.2.19";

function fail(message) {
  console.error(`run-rkbx-link: ${message}`);
  process.exit(1);
}

function versionsInOffsets(text) {
  return [...new Set(text.split("\n").map((l) => l.trim()).filter((l) => /^\d+\.\d+\.\d+$/.test(l)))];
}

// Pre-flight: binary + offsets file must exist.
if (!existsSync(BINARY)) fail(`sidecar binary not found at ${BINARY}`);
if (!existsSync(OFFSETS)) fail(`offsets file not found at ${OFFSETS}`);
const offsetsText = readFileSync(OFFSETS, "utf8");
const known = versionsInOffsets(offsetsText);
console.log(`offsets at ${OFFSETS}: ${known.join(", ") || "(none)"}`);
if (!known.some((v) => rekordboxVersion.startsWith(v))) {
  console.log(`no ${rekordboxVersion} offsets upstream as of 2026-10-12: sidecar will start but likely sends no packets.`);
} else {
  console.log(`Rekordbox ${rekordboxVersion} has offsets.`);
}

const sudoCmd = `sudo "${BINARY}" > "${LOG}" 2>&1`;
console.log(`log: ${LOG}`);
if (dryRun) {
  console.log(`[dry-run] would check: test -x "${BINARY}" && test -f "${OFFSETS}"`);
  console.log(`[dry-run] owner runs in a terminal: cd "${SIDECAR_DIR}" && ${sudoCmd} &`);
  console.log(`[dry-run] would listen on ${OSC_HOST}:${OSC_PORT} for ${WAIT_MS / 1000}s`);
  process.exit(0);
}
const socket = createSocket("udp4");
let received = 0;
let lastBytes = 0;
const done = (ok, detail) => {
  socket.close();
  console.log(ok ? `SUCCESS: ${detail}` : `FAILURE: ${detail}`);
  process.exit(ok ? 0 : 1);
};
socket.on("message", (msg) => {
  received += 1;
  lastBytes = msg.length;
  if (received === 1) console.log(`first packet: ${msg.length} bytes`);
});
socket.on("error", (err) => done(false, `listener error: ${err.message}`));
socket.bind(OSC_PORT, OSC_HOST);
setTimeout(() => {
  done(
    received > 0,
    received > 0
      ? `${received} OSC packet(s) on ${OSC_HOST}:${OSC_PORT}, last ${lastBytes} bytes`
      : `no OSC packets on ${OSC_HOST}:${OSC_PORT} within ${WAIT_MS / 1000}s — check sudo prompt, re-sign, and offsets`,
  );
}, WAIT_MS);
