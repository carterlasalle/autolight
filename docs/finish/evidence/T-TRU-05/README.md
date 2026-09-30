# T-TRU-05: Capability manifest and generated README claims

Closes F-DOC-02, F-APP-13, F-QA-14 (capability part).

## What changed

- New `capabilities.yaml` at repo root: 19 capabilities, each with id, title,
  spec sections, truthful status (13 PARTIAL, 6 MISSING, 0 PASS), missing
  parts naming the owning task, implementation paths, production entry chain,
  and evidence pointer.
- README capability table replaced with the generated block between
  `capabilities:start` and `capabilities:end` markers. Regeneration is
  deterministic from the manifest.
- `tools/capabilities-check.mjs`: fails on unknown statuses, README missing a
  capability, or any PASS (simulator runs never qualify hardware).
- `tools/claim-check.mjs`: sentences with supports/implements/works
  with/verified in README plus user docs must reference a capability ID.
  Research notes and capture logs are out of scope (upstream findings, not
  product claims).

## Proof

- `node tools/capabilities-check.mjs`: OK (19 capabilities, 0 PASS).
- `node tools/claim-check.mjs`: OK.
- The old hand-written capability table (SQLCipher, Serato Remote, Lighting
  IPC, arm/stream, qualification wizard as done) is gone, replaced by
  PARTIAL/MISSING rows that name what is missing.

## Delete test

Delete a capability from the manifest and the checker fails on README drift.
Write PASS and the checker rejects it. Add an unlinked "supports X" sentence
to README and the claim check fails.
