# T-CFG-06: Decision switch framework

Closes F-DEC-01 (DS-01 to DS-36).

## What changed

- New `packages/config/src/decisions.ts`: metadata for every switch DS-01 to
  DS-36 with its options (summary, pros, cons, requirements), the combined
  mode, the default, the measurements that inform the owner's choice, the
  owning tasks, and the registry key that stores the mode where one exists.
  `decisionFor`, `decisionForConfigKey`, `DECISION_IDS` and `decisionModes`
  are the interface the Decision switches tab, the status bar indicator and
  the diagnostics comparison panel read.
- Twenty-nine switches are bound to real registry keys (DS-07 to
  `runtime.host`, DS-18 to `mixer.blackout.policy`, DS-26's curve shape to
  `mixer.crossfader.curve`, and so on). The remaining seven are documented as
  code-level chains or build-time choices: DS-16 (one boolean per discovery
  rung), DS-20, DS-22 (resolver chain order), DS-23, DS-26's source rung,
  DS-27 (per unit, qualification decides) and DS-30 (build-time only, ADR-006).

## Proof

- `packages/config/src/decisions.test.ts`: the catalog is contiguous from
  DS-01 to DS-36, every option documents pros, cons and requirements, the
  default is reachable (as an option or as the combined mode), every bound key
  resolves in the registry with the same DS, the unkeyed set is exactly the
  seven documented switches, and `decisionModes` lists each mode once.
- Scoped smoke run this session: the same integrity checks pass against the
  source, with 29 bound keys and the same unkeyed set.
- Each switch's comparison measurement is a field of its entry and is shown by
  the tab; the E2E flip test and the metrics panel belong to T-CFG-05 and
  T-UI-04.

## Delete test

Remove a `DS-` entry and the contiguity test goes red. Point a switch at an
unknown key and the registry-binding test goes red. Drop the `option` helper's
argument and the pros and cons assertion goes red.

## Wiring note

`packages/config/src/index.ts` does not re-export `decisions.ts` yet: that file
is outside this task's owned paths, and the one-line
`export * from "./decisions.js";` belongs to that file's owner. Consumers can
import the module directly until then.
