# ADR-011: Matter descoped to opt-in whole-fixture fallback

Date: 2026-10-10. Status: decided, pending owner review.

## Context

Issue #5 gap #3: `apps/desktop/electron/services/matter-bridge.ts`
reports degraded — *"Matter utility process not wired (controller lands
with the Matter task)"* — and the `@matter/main` controller path from the
design notes is untouched. Per the transport priority (LAN → BLE → Matter
→ Cloud, SPEC §148), Matter is the clean fallback before cloud, but no
owner Govee unit with Matter support has been identified and no
commissioning has ever run.

The seam is built and honest: `packages/matter/src/controller.ts`
(T-MAT-01) defines the `MatterAdapter` contract (commission on-network
with pairing code / QR payload, multi-admin provenance, `classifyPairingCode`,
`InMemoryAdapter` for CI); `modeAvailability` in
`packages/failover/src/transports.ts` gates `matter-basic` on a verified
capability record, so an unqualified fixture shows the mode disabled with
the reason; `govee.matter.enabled` defaults to `false` (owner decision
per device); `FRAME_CLASS` rates matter as whole-fixture only.

## Decision

Descope the Matter controller to an **opt-in whole-fixture fallback**:

- No `@matter/main` dependency until a real unit needs it. When an owner
  unit with Matter support appears, the T-MAT-01..T-MAT-04 tasks
  (`docs/finish/wp04-ble-matter-cloud-failover.md`) commission it against
  this contract — the decision to wire the controller is recorded then.
- Until then: `govee.matter.enabled` stays `false`; the bridge stays
  `degraded` with its reason; `matter-basic` stays unavailable per
  device with the qualification reason on the tile. No silent behavior.
- Matter never carries segment frames and never serves beat-critical use
  (T-FOV-01 table); cloud stays behind it, never carrying frames at all.

## Consequences

- The LAN → BLE → (Matter when qualified) → Cloud ladder keeps its order
  without an unwired controller pretending to hold a rung.
- Revisit condition: owner presents a Matter-capable unit → run T-MAT-01
  commissioning, qualify per T-MAT-02 rate measurement, flip
  `govee.matter.enabled` per device.

## Alternatives considered

- Wire `@matter/main` now against a virtual light: proves the controller,
  proves nothing about Govee units, adds a heavy dependency for an
  unexercised path. Rejected until hardware exists.
- Remove Matter from the transport union: would shrink the tested
  `transports.ts` policy and the T-MAT seam for no runtime gain.
  Rejected; the explicit-unavailable path is the honest state.
