# ADR-012: Native TypeScript razer codec instead of a vendor fork

Date: 2026-10-10. Status: decided, pending owner review.

## Context

Issue #5 gap #7: SPEC §§44–45 require a pinned/vendor-controlled fork.
`vendor/govee-toolkit/` holds only `PIN.md` (upstream
`damient/govee-toolkit`, pinned revision
`ceef296f6382881c5f07698d78fb5719ebca6686`, node 0.5.0 / rust 0.14.0);
the razer protocol was instead implemented natively in TypeScript
(`packages/govee/src/razer.ts`: `encodeRaw`/`decodeRaw`, `arm`, `paint`,
`PacingStream`, `WALL_SCHEDULER`).

## Decision

Ship the **native TypeScript codec as the razer implementation**;
keep the pinned upstream revision as the protocol reference, not a
build input:

- `PIN.md` stays the provenance record: every frame layout (envelope UDP
  JSON to device:4003, `BB <len> <opcode> <payload> <xor>`, arm vector
  `bb 00 01 b1 01 0a`) cites toolkit `lan.md` sections; golden vectors in
  `protocol-fixtures/govee/razer/` are pinned against the toolkit header.
- `govee.lan.engine` (`packages/govee/src/engines/`, ADR-003) keeps the
  `toolkit` option: if a prebuilt addon ever ships in this repo, `auto`
  runs it primary with the native codec as the per-device fallback, byte
  parity tested. Today no addon is bundled, so every device runs
  `native-ts` with the reason recorded — explicit, never silent.
- SPEC §45's "we cannot ship while relying on probably compatible"
  applies to this reimplementation too: it stays under §52 hardware
  qualification (Gate C) exactly like a fork would. Sim runs prove code,
  never hardware (`docs/qualification.md`).

## Consequences

- No Rust toolchain, no napi prebuilds, no binary-blob review in the
  packaging path; the codec is reviewed like any other TS.
- Protocol drift risk (upstream changes frame layouts) is carried by the
  pinned revision + golden vectors, re-verified whenever the pin moves.
- Revisit condition: §52 qualification fails on a unit where the
  toolkit addon demonstrably succeeds → wire the addon behind the
  existing `toolkit` engine option.

## Alternatives considered

- Full vendor fork with Node binding (`packages/node`
  `SegmentStream.setAll`): heaviest option, needs Rust CI + prebuilds
  for an unproven benefit. Rejected until a unit proves the need.
- Unpinned reimplementation from memory: rejected by §45 outright; the
  pin + provenance headers + golden vectors are the minimum.
