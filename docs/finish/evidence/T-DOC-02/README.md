# T-DOC-02: ADRs for every decision

Closes F-DOC-04, F-LIVE-03.

## What changed

Superseded ADR-001 with ADR-002 through ADR-010 in `docs/adr/`, one per
decision switch group in `03-config-and-decisions.md` section 4:

- ADR-002 Rekordbox live sources and fusion (DS-01, incl. rkbx_link license
  and re-sign caveats; supersedes ADR-001).
- ADR-003 Govee engines and failover (DS-02, DS-03, DS-31).
- ADR-004 Show host placement and clock (DS-07, DS-08).
- ADR-005 Storage driver (DS-06).
- ADR-006 Packaging tool (DS-30, build-time single-option exception).
- ADR-007 Room model and spatial fields (DS-24, DS-25, DS-32, DS-33).
- ADR-008 BLE backend and encrypted link (DS-04, DS-05).
- ADR-009 Beat origin and units (fractional-beat canonical, conversions at
  trust boundaries).
- ADR-010 Config registry (one registry, layers, receipts, secrets
  exclusion, invariants as code).

Each ADR records context, decision, measurements, and owner decision
status (all pending owner review; no measured claim without evidence).

Note: ADR-001 contains pre-existing em-dashes (owner rule bans them in
new docs); that file is another slice's history and was not touched.

## Proof

- `ls docs/adr/`: 001 plus 002 through 010, each with Context, Decision,
  Measurements, Owner decision status sections.
- ADR index note: AGENTS.md section "ADR index" currently reads TBD and
  the file is orchestrator-owned (outside this slice's Target paths);
  Main to point it at `docs/adr/`.

## Delete test

Remove any ADR-002..010 file and the index is incomplete (a directory
listing check fails). Remove the Measurements section from any ADR and a
content check for the four required headings fails.

## Remaining seams

- AGENTS.md ADR index update (orchestrator-owned file; flagged to Main).
- Owner review sign-off per ADR as owning tasks produce measurements.
