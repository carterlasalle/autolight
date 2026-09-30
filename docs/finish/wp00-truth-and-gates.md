# WP00. Truth pass and gates

Goal: every fake in the repository is removed or made real, every test can
fail, and CI mechanically prevents the scars in `00-agent-briefing.md` section 3
from returning. Do this first. It will make CI red; that is the point. Then
the other work packages turn it green honestly.

The ratchet rule. Every gate this package adds (rule packs, Knip,
dependency-cruiser, coverage, mutation, forbidden words, bundle scans)
records its current finding count per rule and per package in
`tools/ratchet.json`. From then on:

- a change that raises any count fails CI;
- a count that reaches zero becomes blocking for that rule or package, and
  `tools/ratchet.json` marks it so, permanently;
- counts only go down by fixing code, never by adding ignore comments, `noqa`,
  `eslint-disable`, `@ts-expect-error`, or exclusions (the ratchet counts
  those too, as findings);
- by the end (`99-final-acceptance.md` section 1) every count is zero and
  every gate is blocking.

This lets M0 finish honestly: the gates exist, they are red where the code is
fake, they can only get better, and each later task turns its part green.

Tools added in this package (all through Yarn or uv):

```sh
yarn add -D knip dependency-cruiser @ast-grep/cli jscpd @vitest/coverage-v8 fast-check \
  @stryker-mutator/core @stryker-mutator/vitest-runner @stryker-mutator/typescript-checker \
  eslint typescript-eslint eslint-plugin-react-hooks license-checker-rseidelsohn
(cd analysis && uv add --dev ruff pyright pytest-cov mutmut hypothesis)
```

Semgrep runs as `uv tool run semgrep` (or `uvx semgrep`). CodeQL runs in GitHub
Actions (`github/codeql-action`, `security-and-quality` suite).

---

### T-TRU-01 Coverage tool and status discipline in CI

- Closes: F-DOC-06 (process part).
- Wire `node docs/finish/tools/check-coverage.mjs` into CI as a required job.
- Add `yarn truth` at the root (with the alias `yarn audit:truth`) that runs:
  the coverage tool, ast-grep scan, dependency-cruiser, Knip, capability
  manifest check, fixture lint, the forbidden-words check, the bundle fixture
  scan (after a build) and the surviving-mutant list check (`T-TRU-08`).
- DoD: `yarn truth` exists and runs in CI; removing a task line from STATUS.md
  makes CI fail (demonstrate in evidence).

### T-TRU-02 Remove fixture data from production; add an explicit Simulator mode

- Closes: F-APP-03, F-APP-07, F-UI-19.
- Delete `publicDir: .../test-fixtures` from `apps/desktop/vite.config.ts`.
  Delete the fixture fetches in `state/resolve-live.ts` and `inspector-view.tsx`.
  Production code may not import `@autolight/simulator` except through the
  Simulator mode entry point below.
- Add an explicit Simulator mode (Setup and Settings toggle, a persistent
  "SIMULATOR" badge in the title bar and status bar). In this mode the provider
  manager runs simulated providers and the govee-manager talks to the
  in-process Govee simulator on real loopback sockets. The same production
  pipeline runs; only the sources and sinks are simulated.
- dependency-cruiser rule: nothing under `apps/desktop/src` or
  `apps/desktop/electron` (except `electron/services/simulator-mode.ts`) may
  import `@autolight/simulator` or read `test-fixtures/`.
- Bundle scan: after `yarn build`, grep the renderer and main bundles for
  fixture filenames (`live-homecoming`, `trackmodel.json`, `showplan.json`);
  any hit fails CI.
- DoD: rule and scan in CI; Live screen shows honest empty states without a
  source; Simulator mode demo recorded as a video in evidence.

### T-TRU-03 No echo IPC

- Closes: F-APP-04.
- With T-ARC-02, add an integration test that enumerates every channel from
  `packages/ipc`, invokes it with a valid request against a running app
  instance (Electron test harness with a recording transport and simulated
  providers), and asserts a channel-specific observable side effect or
  authoritative response (for example `master.blackout` produces black frames
  at the recording transport within 100 ms; `config.set` changes the value
  returned by `config.get`).
- ast-grep rule `no-echo-ipc`: a handler body that returns its payload
  argument, or `schema.parse(payload)` with no other statement, is an error.
- DoD: every channel covered; rule at blocking.

### T-TRU-04 Reachability and architecture gates

- Closes: F-QA-14 (Knip, dependency-cruiser), scar S8, spec 155.
- Knip configured with entry points: `apps/desktop/electron/main.ts`, preload,
  renderer `main.tsx`, `packages/show-host` entry, `analysis` is Python (Vulture
  via `uv add --dev vulture` for dead Python code). Unused exports and files in
  production packages fail CI.
- dependency-cruiser: forbidden rules (renderer may not import show-runtime,
  show-mixer, renderer, govee, simulator; show-host may not import electron;
  planner may not import govee or venue device internals) and required
  reachability rules (main must reach provider-manager, analysis-supervisor,
  storage-service; show-host must reach show-runtime, show-mixer, renderer,
  govee manager).
- DoD: both run in CI under the ratchet rule with today's counts recorded;
  red run on current code saved as evidence; each rule turns blocking at zero.

### T-TRU-05 Capability manifest and generated README claims

- Closes: F-DOC-02, F-APP-13, F-QA-14 (capability manifest and claim tests), scar S4 and S15.
- Create `capabilities.yaml` at the repository root. One entry per capability
  (at least one per SPEC section with behaviour, plus owner additions):
  `id`, `title`, `spec` sections, `status` (the capability vocabulary from
  `00-agent-briefing.md` section 5.1a: `PASS`, `IMPLEMENTED_UNQUALIFIED`,
  `PARTIAL`, `FAIL`, `UNAVAILABLE_ON_THIS_DEVICE`, plus `MISSING` for work not
  started), `missing` (list of missing parts, required when `PARTIAL`),
  `implementation` (paths), `entry` (the production call chain from
  `main.ts` or the show host entry, as a list of symbols), `tests` (test IDs),
  `evidence` (evidence folder), `hardware` (per SKU and per unit:
  `IMPLEMENTED_UNQUALIFIED` or `PASS` with qualification record path, date and
  firmware), `platforms` (macOS, Windows, with `UNAVAILABLE_ON_THIS_DEVICE`
  reasons where they apply), and `tenPoint` (one boolean per item of the
  ten-point definition of done in section 2.1 of the briefing, each with the
  evidence file that proves it).
- A checker validates: `IMPLEMENTED_UNQUALIFIED` requires existing
  implementation paths, a resolvable `entry` chain (checked against the Knip
  and dependency-cruiser graph), existing tests, and an evidence folder with
  README; `PASS` additionally requires all ten `tenPoint` items true and, for
  hardware or third-party-software capabilities, a qualification artifact
  that is not a simulator run. `FAIL` requires a failure record. The app
  reads the same manifest (compiled into a JSON resource) plus runtime
  qualification records so the UI and the README cannot disagree. The README
  capability table between
  `<!-- capabilities:start -->` and `<!-- capabilities:end -->` is generated from
  the manifest; CI fails if it differs.
- Claim check: a small script scans README and `docs/*.md` (not SPEC) for
  phrases "supports", "implements", "works with", "verified" and requires each
  sentence to reference a capability ID or be inside the generated block.
- DoD: manifest complete with truthful statuses today (almost everything
  `missing` or `partial`); README regenerated; checks in CI.

### T-TRU-06 Anti-pattern rule pack

- Closes: scars S1 to S28 mechanically where possible; F-APP-13, F-DOC-02, F-QA-14 (ast-grep and Semgrep rule packs).
- ast-grep rules in `tools/ast-grep/rules/` (each with positive and negative
  test snippets committed next to it):
  `no-echo-ipc`, `no-empty-catch`, `no-catch-undefined`
  (`.catch(() => undefined)` and `catch {}` with no statement),
  `no-void-discard` (`void <identifier>;` statements),
  `no-tautological-expect` (`expect(true)`, `expect(x).toBe(x)` same
  identifier), `no-golden-self-write` (writeFileSync into `test-fixtures` or
  `*golden*` inside tests), `no-absolute-user-path` (`/Users/`, `C:\\Users\\`,
  `/home/` literals outside docs), `no-child-process-in-hot-path` (in
  `packages/govee`, `packages/show-*`, `packages/renderer`),
  `no-magic-number` (T-CFG-04), `no-string-ipc` (renderer calling
  `invoke("...")`), `no-simulator-import`, `no-fixture-fetch`,
  `no-relative-runtime-path` (S24), `no-spawn-dev-tools` (S25: `spawn` or
  `execFile` of `node`, `npx`, `npm`, `python`, `python3`, `pip` in product
  code), `no-unbounded-live-queue` (S26), `no-env-gated-behaviour` (S28:
  `process.env.*` reads outside the config service and the path service),
  `no-literal-metric-in-ui` (S6: numeric literals rendered next to units such
  as fps, ms, segments in `apps/desktop/src`).
- Forbidden words check for production code, UI strings and user docs: `TODO`,
  `FIXME`, `ponytail`, `stub`, `placeholder`, `mock` (outside test helpers),
  `future`, `coming soon`, `not yet`, `v2` (as a deferral), `phase 2`.
- Python: Ruff with `BLE001` (blind except), `S110` (try-except-pass),
  `E722`, `PLR2004` (magic values, with the config allowlist), `ARG`, `F`.
- Semgrep rules for anything ast-grep cannot express (taint from network input
  to eval, for example).
- Each rule also becomes a Bug Corpus detector where it guards a confirmed bug.
- DoD: every rule exists with positive and negative snippet tests, runs in
  CI under the ratchet rule with today's counts recorded, and turns blocking
  at zero; red run saved. Zero findings everywhere is required by
  `99-final-acceptance.md` section 1, not by this M0 task.

### T-TRU-07 Vitest configuration and coverage

- Closes: F-QA-01, F-QA-08, F-QA-14 (coverage gates).
- Every workspace `vitest.config.ts` includes `src/**/*.test.ts` only and
  excludes `dist`. Add a root script printing unique test count per package.
- Coverage with `@vitest/coverage-v8`; thresholds from AGENTS.md (line 85,
  branch 80, function 90, statements 85; new code 95 and 90) enforced per
  package; `pytest-cov` for Python with the same thresholds.
- Critical packages get a stricter floor: branch coverage at least 90 and
  line coverage at least 95 for `contracts`, `config`, `show-runtime`,
  `show-mixer`, `renderer`, `show-planner`, `venue` (including the room
  model), `govee` codecs and link managers, `rekordbox-live` decoders and the
  fusion provider, `controller-flx4` decoder, `ipc`, and Python
  `autolight_analysis/{events,structure,fusion,features,native,worker}.py`.
- DoD: CI prints counts; coverage is measured for every package and
  enforced under the ratchet rule (a package's coverage may not drop, and its
  threshold becomes blocking once met); any package below threshold is listed
  in STATUS.md with the task that raises it (not waived). The
  thresholds are config in `vitest.workspace.ts` and `pyproject.toml`, and
  lowering one requires an entry in `docs/finish/evidence/T-TRU-07/threshold-changes.md`
  with the owner's approval.

### T-TRU-08 Mutation testing

- Closes: F-QA-08, F-QA-14, scar S2.
- Stryker on `contracts`, `show-runtime`, `show-mixer`, `renderer`,
  `show-planner`, `venue`, `govee` codecs, `rekordbox-live` decoders,
  `controller-flx4` decoder. mutmut on `autolight_analysis/{events,structure,fusion,features,stems}.py`.
- Nightly full run; PR run on changed files. Mutation score floor 85 for
  every listed module (AGENTS.md says 75; the owner's finish round raises it).
- Zero surviving mutants in the safety-critical list, which is enforced by
  name: the blackout path (`master.blackout` handler through the layer stack
  to the transport), the razer and BLE frame encoders and checksums, the
  arm and disarm lifecycle, the no-power-cycle and no-kelvin invariants, beat
  to time mapping in both directions, seek detection, crossfader weight, the
  exclusive impact owner, the restraint budget checks, the config validator
  and the IPC schema validators. `tools/mutation/critical.json` lists the
  functions; the checker fails if any mutant in them survives or times out
  without being classified.
- DoD: Stryker and mutmut wired (nightly full, PR changed files), reports in
  evidence, `tools/mutation/critical.json` committed, and the score of each
  listed module ratcheted (it may not drop; the floor becomes blocking once
  met). The floor of 85 for every listed module and zero survivors in the
  critical list are required by `99-final-acceptance.md` section 1; the task
  that finishes each module (for example `T-GOV-02` for the razer codec)
  brings that module to the floor.

### T-TRU-09 Python lint and types

- Closes: scar S5 in Python, F-QA-14 (Python static checks).
- `ruff check`, `ruff format --check`, `pyright` in strict mode for
  `autolight_analysis`. Wire into `yarn truth` via `uv run`.
- DoD: zero findings.

### T-TRU-10 Security and license scanning

- Closes: spec 112 enforcement, F-QA-14 (CodeQL).
- CodeQL workflow for JavaScript/TypeScript and Python. License checker for
  Yarn dependencies (`yarn dlx license-checker-rseidelsohn` or the dev
  dependency above) and, for Python, a license report produced from the locked
  environment with a license tool added as a dev dependency (`uv add --dev
  pip-licenses`, run with `uv run pip-licenses --format=json`), with a
  denylist (GPL, AGPL, unlicensed) for anything bundled; model weights and
  bundled binaries (FFmpeg, uv, Python) are listed by hand in the same report;
  rkbx_link is never a dependency. The check also fails on any file, weight
  or dataset from the unlicensed 2026 Skip-BART or SeqLight repositories
  (spec 112: research inspiration only).
- DoD: workflows green; license report in evidence; `THIRD_PARTY_NOTICES`
  generated (T-DOC-04).

### T-TRU-11 CI pipeline rewrite

- Closes: F-OPS-08, F-QA-06 partial, F-QA-14 (staged CI), spec 84, 85.
- Stages (each a job, fail fast): format; lint (ESLint, Ruff); types (tsc,
  pyright); dead code (Knip, Vulture); architecture (dependency-cruiser);
  truth (`yarn truth`); unit (Vitest, pytest) with coverage; mutation-fast
  (changed files); replay (all protocol fixtures); integration (show host with
  simulators, analysis worker); Electron E2E (Playwright `_electron`, macOS and
  Windows runners, Linux with xvfb as extra); conformance (manifest and
  matrix probes report); package (electron-builder for mac and win);
  smoke-install (install the artifact on the runner and launch headless
  checks). Nightly: full mutation, fuzzing of protocol parsers, timing harness,
  4-hour SIM soak.
- Use `uv sync --frozen --all-groups` for Python in CI.
- DoD: every stage exists and runs on every push; stages whose subject does
  not exist yet (package, smoke-install, soak) run and fail visibly, each
  listed in STATUS.md with the task that turns it green; each stage's red run
  on today's code saved where it applies. A fully green pipeline is required
  by `99-final-acceptance.md` section 8, not by this M0 task.

### T-TRU-12 Runtime invariants

- Closes: F-QA-14 (runtime invariants), scar S17.
- In test and diagnostic builds, and as cheap checks in production with
  telemetry to diagnostics (never crashing the show): per-device pending frames
  at most 1; no `turn off` or kelvin `colorwc` sent to an armed fixture during a
  show; a fixture qualified as segmented receives frames with its full zone
  count; show host tick runs on a thread different from the renderer's;
  beats are finite; DeckState age within `live.provider.staleMs` or clock
  health not `live`; brightness command rate under
  `govee.brightness.maxPerMinute`; no cloud transport carrying frames.
- DoD: each invariant has a test that violates it deliberately and observes
  the report.

### T-TRU-13 Record the scars in AGENTS.md

- Closes: F-DOC-06.
- Fill "Known agent anti-patterns / scars" in AGENTS.md repository memory with
  S1 to S28 (one line each, with the file that exhibited it). Fill canonical
  commands (install, develop, focused test, full test, lint, typecheck, build,
  DoD command) with commands that were actually run.
- DoD: AGENTS.md has no TBD in canonical commands; scars listed.

### T-TRU-14 Delete dead and duplicate code after replacement

- Closes: F-REND-09, F-GOV-19, F-RBL-07 (with T-RBL-05), scar S10.
- Remove `createHash` import from `packages/renderer/src/index.ts`, the
  duplicate `grid_warning` in `fusion.py`, `collapseToSingleColor`,
  `frameToLan`, `show-service.ts`, `govee-lan.ts`, `follow.ts` (after their
  replacements land), the "Lightwave order" comment, duplicate `latencyBeats`.
  jscpd in CI with a threshold.
- DoD: jscpd report below threshold; Knip clean.

### T-TRU-15 Replace the fake tests

- Closes: F-QA-02, F-QA-03, F-PLAN-12, F-LIVE-02.
- Delete `expect(true).toBe(true)` in `e2e/night.spec.ts`. Rewrite
  `night.spec.ts`, `soak.spec.ts` and `live-session.spec.ts` as real Electron
  E2E tests (T-QA-02) or move their pure checks into unit tests with honest
  names. The accelerated soak becomes `simulator-throughput.test.ts` and the
  real soak lives in T-QA-06.
- The planner golden test must fail when the golden file is missing. Goldens
  are updated only by `yarn golden:update --reason "<text>"`, which writes the
  reason into `test-fixtures/goldens/CHANGELOG.md`.
- `replayFixture` is replaced by a replay harness that decodes `capture`
  (T-QA-03). A fixture with an empty capture fails the fixture lint.
- DoD: red-then-green evidence for each rewritten test.

### T-TRU-16 Portable Python tests

- Closes: F-ANA-25, scar S19.
- Replace `/Users/rocket/...` paths with committed fixtures: synthetic ANLZ
  files generated by a script (`analysis/tests/fixtures/make_anlz.py`, writing
  PQTZ, PSSI (including an EXT variant that triggers the ConstError path),
  PCO2, PWV6, PWV7, PWVC) and synthetic audio generated with numpy at test
  time. Owner-library tests move to `analysis/tests/owner/` and run only when
  `AUTOLIGHT_OWNER_LIBRARY=1`; they skip with an explicit reason otherwise.
- DoD: `uv run --project analysis pytest -q` green on a clean Linux, macOS and
  Windows runner.

### T-TRU-17 Toolchain facts

- Closes: F-OPS-07.
- Add `"engines": { "node": ">=22.12" }` (use the version you actually build
  with) to the root `package.json`; document that Electron bundles its own
  Node version (print it in `app.environment`). Add root scripts:
  `dev` (starts Vite and Electron together with the show host), `truth`,
  `verify:all` (everything CI runs locally), `golden:update`.
- DoD: README quickstart runs as written on a clean clone (evidence: terminal
  log).

---

## Documentation tasks

### T-DOC-01 Rewrite the documentation set

- Closes: F-DOC-01, F-DOC-03, F-DOC-05, F-APP-13, F-APP-16.
- Replace the stubs with real documents that describe implemented behaviour:
  `docs/architecture.md` (from 04), `docs/govee.md` (LAN, BLE, Matter, cloud,
  failover, qualification, profiles), `docs/rekordbox-protocol.md` (every
  provider, the version matrix, capture procedure), `docs/serato-protocol.md`,
  `docs/track-model.md` (v2 schema, readiness, provenance), `docs/show-planner.md`
  (hierarchy, primitives, restraint, recurrence, styles), `docs/room-mapping.md`
  (WP05), `docs/qualification.md` (runbooks), `docs/config-reference.md`
  (generated), `docs/troubleshooting.md` (network checklist from SignalRGB and
  govee2mqtt, port 4002 conflicts, BLE permissions, Local Network permission,
  MIDI exclusivity on Windows). Fix README spec range (155 sections), launch
  instructions, and `vendor/README.md`.
- DoD: every doc links to the capability IDs it describes; claim check passes.

### T-DOC-02 ADRs for every decision

- Closes: F-DOC-04, F-LIVE-03.
- Supersede ADR-001 with ADR-002 (Rekordbox live sources and fusion, DS-01,
  including rkbx_link, license and re-sign caveats), ADR-003 (Govee engines
  and failover, DS-02, DS-03), ADR-004 (show host placement and clock, DS-07,
  DS-08), ADR-005 (storage driver, DS-06), ADR-006 (packaging tool, DS-30),
  ADR-007 (room model and spatial fields), ADR-008 (BLE backend and encrypted
  link, DS-04, DS-05), ADR-009 (beat origin and units), ADR-010 (config
  registry).
- DoD: ADR index in AGENTS.md; each ADR lists measurements and the owner
  decision status.

### T-DOC-03 CONTRIBUTING and AGENTS alignment

- Closes: F-DOC-06.
- CONTRIBUTING describes the real test layers, E2E, replay, goldens, Bug
  Corpus, `yarn truth`, evidence folders and the no em-dash rule for docs.
- DoD: steps in CONTRIBUTING executed on a clean clone (evidence log).

### T-DOC-04 THIRD_PARTY_NOTICES and provenance headers

- Closes: F-DOC-07.
- Generate `THIRD_PARTY_NOTICES` from the license report; add provenance
  headers to every file adapted from govee-toolkit, govee2mqtt, Lightwave,
  govee-homeassistant, serato-connect, rekordbox-connect, alphatheta-connect,
  pyrekordbox, all-in-one-infer, beat_this and dysentery (documentation only).
  Nothing from rkbx_link, rkbx_os2l or LedFx enters the tree, and nothing
  from Skip-BART or SeqLight (no license file; spec 112).
- DoD: notices file present; header check in `yarn truth`.
