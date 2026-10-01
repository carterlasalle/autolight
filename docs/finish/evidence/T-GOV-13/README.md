# T-GOV-13: H6076 and H1A45 profiles

Closes F-GOV-15. Spec 42 to 45. Builds on the T-GOV-11 wizard records (what a
unit's measurements replace) and the T-GOV-02 codec seam.

## What was built

- `devices/H6076.yaml` and `devices/H1A45.yaml` (new): the fork's device
  profiles in the subset of the toolkit device schema our loader validates
  (`govee-toolkit/device-profile@fork-1`). Each profile carries the SKU facts
  (name, family, modes), the product-material claims (the H6076 segment claim
  from spec 42, the 20 m length from spec 43), the capability defaults, and the
  measurement defaults named in T-GOV-13: arm settle, frame rate by zone count,
  fallback rate, turn and white behaviour, status-while-armed behaviour, native
  pixels per metre and the segment chain.
- `packages/govee/src/profiles.ts` (new): the catalog loader, the profile lint
  (`P-45-profiles`) and the rate helper.
  - Every number is a `Measured<T>`: `value`, `source` (one of `unmeasured`,
    `product-material`, `toolkit-default`, `toolkit-measured-other-sku`,
    `sim-verified`, `hardware-measured`) and a `receipt`. A missing or empty
    receipt throws, and the loader refuses a profile whose file name does not
    match its SKU or whose `qualification_required` is not true.
  - `capabilities.segmented` and `capabilities.lan_razer` are `null` with an
    `unmeasured` receipt: the razer channel is decided per unit by the T-GOV-10
    probe, never by the SKU (this is the F-X-09 answer in data). The lint
    refuses a profile that sets `segmented` true from anything other than a
    hardware measurement.
  - `defaultRateHz()` encodes F-GOV-22: the profile's measured ceiling for the
    nearest zone-count key at or below the qualified count, else the fallback
    rate, never above `govee.lan.stream.targetHz`. The table in both profiles
    is the toolkit's H61A0 measurement (40 Hz at 20 zones, 25 at 60, 20 at 120)
    with a receipt that says in plain words that it was not measured on these
    SKUs and is replaced by the wizard's step-13 sweep for the unit.
  - A minimal YAML subset parser (nested maps, lists, scalars, comments) so the
    package keeps zero runtime dependencies; anything outside the subset throws
    with a line number.
- Nothing here claims a hardware measurement. No unit has been qualified on
  hardware, so every source in the committed profiles is `product-material`,
  `toolkit-default`, `toolkit-measured-other-sku` or `unmeasured`, and the
  tests assert exactly that (the guard that keeps the profiles honest).

## What passes today vs what waits

- Passes today: 5 tests in `packages/govee/src/profiles.test.ts`.
  1. both profiles load, every measurement has a receipt, no source is
     `hardware-measured`, `segmented` and `lan_razer` stay unmeasured, and the
     lint is clean for both.
  2. the rate helper: fallback 10 Hz below the table, 40 at 20 and 40 zones, 25
     at 100, 20 at 200, and the target never wins over the ceiling.
  3. a profile whose number has no receipt is refused (temp directory fixture).
  4. a profile whose file name does not match its SKU is refused.
  5. the YAML subset parses nested maps, lists, quoted keys and scalars, and
     rejects a document outside the subset.
- Waits on hardware: the measurement receipts that name the wizard steps
  (arm settle via step 12, the rate table via step 13, native pixels per metre
  and the segment chain via step 9) need the owner's `HW-GOV-02` and
  `HW-GOV-03` runs per unit. Those runbooks are referenced, not claimed, and
  the profile values stay defaults until then.
- Waits on an owner decision: offering the profiles upstream to govee-toolkit
  is an owner decision (wp03 T-GOV-13) and has not been done.
- Waits on the registry: storing the profiles in the app profile DB is
  T-GOV-06's registry work; the loader in this slice is what loads the YAML in
  tests and what a manager can call for defaults.

## Proof

- `cd packages/govee && npx vitest run src/profiles.test.ts` : 1 file, 5 tests
  passed.
- `cd packages/govee && npx vitest run src/profiles.test.ts src/probe.test.ts
  src/actions.test.ts src/qualification.test.ts` : 4 files, 25 tests passed,
  run repeatedly, stable.
- `cd packages/govee && npx tsc --noEmit -p tsconfig.json` : no output (clean).
- Red run: `profiles.test.ts` imports a module that does not exist at HEAD, so
  it cannot pass there. At behaviour level, removing a `receipt:` line from
  `devices/H6076.yaml` makes the loader test red; renaming either file so it no
  longer matches its SKU makes the lint test red; changing one table value in
  a profile makes the rate test red.

## Delete test

Delete `devices/H6076.yaml` or `devices/H1A45.yaml` and the catalog test fails
(the expected SKU set no longer loads); delete the whole `devices/` directory
and `loadDeviceCatalog` throws "no .yaml profiles". Delete
`packages/govee/src/profiles.ts` and the profile tests fail to import. Remove
the receipt check from `measured()` and the no-receipt test goes red. Remove
the basename check from `lintDeviceProfile` and the file-name test goes red.
Set `capabilities.segmented.value: true` in a profile and the lint plus the
no-hardware-claim assertion go red, which is the point: a profile may not
promise a channel that only the per-unit probe can prove.
