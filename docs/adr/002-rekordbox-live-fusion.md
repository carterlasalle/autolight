# ADR-002: Rekordbox live sources and fusion

Date: 2026-10-01. Status: decided, pending owner review.
Supersedes: ADR-001 (which chose AX-first and never evaluated rkbx_link).

## Context

ADR-001 scoped follow modes (preview, ax-beat, prolink, soundswitch) without
evaluating the rkbx_link sidecar (F-LIVE-03), although the owner marked it
REALLY IMPORTANT. DS-01 names seven sources plus fusion.

## Decision

Implement every DS-01 source behind the `live.provider` switch with `fusion`
as default: lighting-ipc, memory-cleanroom, rkbx-osc, prolink,
composite-flx4, ax, os2l. Fusion ranks fields by authority (lighting, memory,
rkbx, prolink, composite, ax, os2l), cross-validates, switches authority with
hysteresis (`live.fusion.disagreeBeats`, `live.fusion.switchHoldMs`), and
labels every field's source.

rkbx_link is a user-installed GPL sidecar, never bundled (spec 112). The
memory reader is an opt-in elevated helper with consent flow and audit log
(T-SEC-05); the app never performs re-sign or elevation itself.

## Measurements

Per source: update rate, beat error against the chosen authority, state age,
fields provided, dropouts (Decision switches tab, T-CFG-06).

## Owner decision status

Pending: owner confirms rkbx_link installation path and memory-reader consent
wording before M3 validation set review.
