# T-ID-01: Durable identity, alias graph, file hash and PCM fingerprint

Closes F-ID-01, F-LIVE-07. Probe P-12-rename-survives. Spec 12, DS-34.

## What was wrong

No durable identity resolver existed: no alias graph, no file hash (the
first-MB `decode.file_hash` was unused), no PCM fingerprint, no rename or
move migration. The planner seeded from the database row ID. The composite
row carried `canonicalPath` but `rowToIdentity` read `filePath`.

## What changed

- `packages/track-identity/` (new package): `src/alias.ts` (alias graph,
  `MemoryAliasStore`, `resolveTrackId` with pcm-hash/fileHash-first matching
  and rename/move attachment, `TrackAliasStore` SQL seam for the
  `track_aliases` table), `src/hash.ts` (`fileHashOf` full plus sampled with
  `library.fileHash.strategy` semantics, sampled labelled weak),
  `src/fingerprint.ts` (DS-34: `pcmHashOf` SHA-256 of the quantized canonical
  decode, `landmarkHashes` plus `acousticSimilarity` over the documented
  Chromaprint-style algorithm with no GPL code and no fpcalc binary,
  `acousticProposesLink` proposing owner-confirmed links above
  `identity.fingerprint.acousticThreshold`, never auto-merging),
  `src/index.ts` re-exports.
- `rowToIdentity` already read `canonicalPath` with the `filePath` fallback
  (F-LIVE-07 closed at the API level before this slice; kept, not rewritten).
- OD-08 recorded: fpcalc stays out of the installer; the acoustic path needs
  no external binary.

## Proof

- `yarn workspace @autolight/track-identity test`: 8 passed (rename, move
  and retag keep one TrackId; re-encode matches by pcm-hash; title-only
  input claims nothing; alias rows survive a store rebuild; acoustic
  self-similarity 1 with cross-track below threshold; seed fallback chain).
- Failing-capable: delete the strong-alias priority and the move test
  resolves a second TrackId; delete the sampled size header and the
  size-sensitivity test goes green-on-wrong (hash no longer distinguishes);
  lower the acoustic threshold to 0 and different tracks propose links.

## Delete test

Delete `src/alias.ts` and every rename test fails to import. Restore
title-only resolution and the unclaimed-title test goes red. Reintroduce
auto-merge on acoustic match and the propose-never-merge test names the
regression to write.

## Seams

- App wiring (outside this slice): persist `MemoryAliasStore` rows to
  `track_aliases` via `TrackAliasStore`, compute `fileHashOfPath` at
  library scan and `pcmHashOf` at canonical decode (T-ANA-03 output).
- T-ID-03 (TrackIdUi): `TrackStateMap.retain` consumes the alias-graph
  track enumeration when it lands.
- AnalysisM3 (T-ANA-12): `nativeAnalysis.rekordbox.outcomes` is the
  provenance input for the v2 model.
