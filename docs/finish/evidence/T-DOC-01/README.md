# T-DOC-01 Rewrite the documentation set

Closes F-DOC-01, F-DOC-03, F-DOC-05, F-APP-13, F-APP-16. Main ruling: allowed README.md plus docs/*.md user docs outside finish/; never docs/finish/**, docs/SPEC.MD; no em-dashes everywhere.

## State: scaffold landed, prose rewrite outstanding

Landed this slice: corrected the README spec-range pointer (150 to 155) is still TODO; `vendor/README.md` already honest (codec independently implemented and tested; fork owns the live binding). The stub user docs (`docs/architecture.md`, `docs/govee.md`, `docs/rekordbox-protocol.md`, `docs/serato-protocol.md`, `docs/track-model.md`, `docs/show-planner.md`, `docs/room-mapping.md`, `docs/qualification.md`, `docs/troubleshooting.md`) still describe aspirations, not the implemented behavior the other slices just built.

## Remaining work (explicit, not claimed)

Per-doc rewrite against the landed code with capability-ID links (claim check green): architecture from 04 plus the real module graph; govee LAN/BLE/Matter/cloud/failover/qualification/profiles; rekordbox providers plus version matrix plus capture procedure; serato; track-model v2 plus readiness plus provenance; show-planner hierarchy/primitives/restraint/recurrence/styles; room-mapping WP05; qualification runbooks; config-reference regeneration; troubleshooting from the network checklist. Fix README launch instructions (`yarn dev` starts Vite only; F-APP-16) and the spec range line.

## Seam

Doc prose depends on sibling slices landing; rewriting now would document moving code. This task should run after M2 sources settle.
