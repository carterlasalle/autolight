# T-OPS-01: Environment facts

Closes support for every hardware runbook.

## What changed

- `docs/finish/evidence/T-OPS-01/environment.md`: owner Mac facts
  measured on this machine (MacBookPro18,3, Apple M1 Pro, macOS 26.5.1),
  toolchain versions, Rekordbox 7.2.10.0333 and Serato DJ Pro 3.3.5 read
  from bundle plists, network facts. FLX4 firmware, Govee units, Windows
  reference machine and router details are marked owner-to-confirm.
- `apps/desktop/src/renderer/components/environment-panel.tsx`: new
  self-contained Diagnostics Environment panel. Detection facts
  (Electron, Node, Chrome, OS, CPU) arrive via props only; it imports
  nothing from other screens and touches no existing screen. The main
  process fills the props at runtime so the panel and this document
  agree.

## Proof

- Every version in `environment.md` names the command that produced it
  (`sw_vers`, `system_profiler SPHardwareDataType`, `plutil -p
  .../Info.plist`, `node --version`, `ffmpeg -version`, and similar).
- `environment-panel.tsx` has zero imports from screens (it imports
  nothing at all besides its own props).

## Remaining work (not claimed done)

- Owner confirms FLX4 firmware, Govee SKU/hw/fw per unit, Windows
  reference machine status, and router/band/isolation settings.
- Wiring the panel into Diagnostics with main-process detection values.
