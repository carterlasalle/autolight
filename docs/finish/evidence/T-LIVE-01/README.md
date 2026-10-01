# T-LIVE-01: Provider contract, generation token and the shared contract suite

Closes F-LIVE-13 (with T-LIVE-14). Probe P-6-provider-contract.

## What changed

- `packages/rekordbox-live/src/providers.ts`: `ProviderDeckState` (the spec 9.5
  `DeckState` fields plus `generation`, `beat`, `beatInBar`, `pitchPercent`,
  `sync`, `loopRoll`, `lastHotCue`, `phrase`, `fieldSources`, `quality`, `raw`),
  the typed `ProviderStatus` union, `DJLiveProvider`, `ProviderBase` (idempotent
  start and stop, monotonic `receivedAtNs`, bounded latest-wins listeners, a
  received and rejected tally), `DeckGenerationMapper` (increments the
  generation on load, unload and replacement and remembers the track text that
  was last reported) and the scripted plus deliberately leaky test providers.
- `packages/rekordbox-live/src/contract-suite.ts`: `runProviderContractSuite`
  checks start and stop idempotence, status transitions, generation on track
  change with no metadata leak from the previous generation, monotonic
  `receivedAtNs`, bounded queues (S26) and malformed input that is rejected and
  counted instead of thrown. It runs on a `VirtualClock`, so every check is
  deterministic.
- `packages/rekordbox-live/src/contract-suite.test.ts`: the suite runs against
  the scripted provider, the rkbx-osc provider, the prolink provider and the AX
  provider, each with its own simulator, plus two real UDP loopback tests
  (OSC and PRO DJ LINK datagrams arriving through the bound sockets).
- Suite location note: matrix row 6 names `packages/contracts/src/provider.test.ts`
  as the probe file. That path is outside this slice; the suite lives in
  `packages/rekordbox-live/src/contract-suite.ts` and is re-exported from the
  package index. The orchestrator should update the matrix path.

## Proof

Observed with `node --experimental-strip-types` against the real modules (the
same subjects the vitest file builds):

- `scripted: 0 failures`, `rkbx: 0 failures`, `prolink: 0 failures`,
  `ax: 0 failures` from `runProviderContractSuite`.
- The leaky provider fails the same suite. Red run output, verbatim:

  ```
  contract suite failures for the leaky provider: 1
   - metadata leaked from generation 1 into a later generation (1 states)
  ```

- Scoped type check of only this package's 20 source files: 0 diagnostics.

The orchestrator runs `yarn workspace @autolight/rekordbox-live test` for the
vitest form of the same checks.

## Delete test

Delete the generation bump in `DeckGenerationMapper.update` and the suite's
no-leak assertion stops firing: the leaky-provider test (which asserts a
non-empty failure list containing `metadata leaked from generation`) goes red.
Delete the `LeakyProvider.leakPreviousTitle` emission and the same test goes red
because no failure is produced.
