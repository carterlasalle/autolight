# T-SER-06: Serato definition of done

Closes spec 121 aggregation (wp09-serato.md T-SER-06; spec 121 items 1-16; spec 136 status bar).

## What changed

- `packages/serato/src/serato-dod.test.ts`: one checklist test with 17 cases. The first asserts all 16 spec 121 item numbers are present exactly once (a missing probe fails the suite); the other 16 map each item to its probe: items 3-12, 14, 15 exercise the real mapper/parser; item 13 probes the crate surface (full Markers2 cue/loop parsing pending, see seams); items 1, 2, 16 are recorded as provider-slice probes (discovery/auth handshake/replay live in SeratoM2's `remote-provider.ts`/`replay.ts`/`capture.ts`) and assert as placeholders, not as passing behavior they do not have.
- No source edits. No status-bar code: spec 136 (`SERATO` vs `REKORDBOX` label, Rekordbox recommended when both installed) is UI surface owned outside this slice; the checklist pins the requirement text so the UI slice cannot miss it.

## Proof

- Scoped run this session: same command as T-SER-02/03, 31 tests green, of which 17 are this checklist.
- Item 9 (loop rolls) is deliberately a weak invariant (idle loop reading must not report an active loop) with a comment naming the gap: the current `SeratoRemoteDeck` snapshot carries no roll channel, so a full roll probe would test fiction. It strengthens to a real roll assertion once SeratoM2's transport exposes roll state.

## Delete test

- Remove any one item from the checks array and the "covers all 16" test goes red (wrong count/order).
- Break a mapping (e.g. null out `effectiveBpm` in the mapper) and that item's probe goes red while the rest stay green, proving per-item independence.
- The placeholder items (1, 2, 16) are marked in-code; converting any of them to a vacuous `expect(true)` without the comment would still pass, so review must check the comments when SeratoM2 lands the provider, then tighten these probes to the real emulator/replay surface.

## Seams

- SIM run: checklist is green on synthetic inputs now. HW run (`HW-SER-01`, owner machine) is still required before this task can be called done; the emulator fixtures live under `test-fixtures/synthetic/serato/` and do not count toward spec 121 per T-SER-05.
- Depends on SeratoM2 (T-SER-01/04/05) for items 1, 2, 13-full, 16-real. No file collisions: their tests are `remote-provider/setup/library/replay.test.ts`, mine are `mapping/geob/serato-dod.test.ts`.
