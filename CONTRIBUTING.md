# Contributing to AutoLight

AutoLight is a live performance tool. Small changes can affect show timing, fixture output, library reads, or emergency controls. Contributions are welcome when they preserve the timing-truth pipeline and include evidence for the behavior they change.

Read [AGENTS.md](AGENTS.md) for repository-specific engineering rules and [docs/SPEC.MD](docs/SPEC.MD) for normative requirements.

## Development setup

### Prerequisites

- Git
- Node.js `22`
- Yarn `4.9.2` (`packageManager` field in `package.json`)
- Python `3.12+` with `uv`
- FFmpeg on `PATH`

```bash
git clone https://github.com/carterlasalle/autolight.git
cd autolight
yarn install --immutable
```

Confirm the baseline before editing:

```bash
yarn typecheck
yarn test
yarn verify:phase1
```

The desktop app has its own workspace commands:

```bash
cd apps/desktop
yarn dev              # Vite renderer at http://localhost:5173
yarn build            # renderer + main + preload into dist/
yarn test:e2e         # Playwright journeys (needs built renderer)
```

See the [README](README.md#quick-start) for run instructions.

## Branch and commit workflow

1. Start from current `main`.
2. Create a focused branch such as `feat/venue-orientation` or `fix/cursor-seek`.
3. Keep each commit coherent and independently reviewable.
4. Use an imperative subject with a conventional prefix: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, or `refactor:`.
5. Push the branch and open a pull request. Do not push directly to `main`.

Pull requests require current status checks (macOS + Windows matrix) and resolved review threads.

## Making a change

### Behavior changes and bug fixes

Write a failing test for the observable contract first. Then make the smallest complete fix and show the test passing. Prefer an existing test layer:

- `packages/*/src/*.test.ts` for package behavior (Vitest)
- `analysis/tests/` for the Python pipeline (pytest)
- `apps/desktop/e2e/` for critical user journeys (Playwright, real fixtures only)
- `protocol-fixtures/` + `replayFixture` for transport decoders

Do not add tests that assert mock/demo UI text, lock in incidental formatting, or duplicate type checking. E2E specs must use real `test-fixtures/analysis` TrackModels — never mock tracks, fixtures, or BPM.

### Planner and renderer changes

- Plans are deterministic: same track + style + planner version → same ShowPlan. Update `test-fixtures/analysis/planner-golden.json` deliberately when intended behavior changes.
- Renderer golden frames (`packages/renderer/src/index.test.ts`) pin exact output. A hash change means visible output changed — say what and why in the PR.
- Restraint rules hold: palettes stay at 2 hues + white (§28–29); live audio overlay stays ≤20% brightness/sparkle and never restructures the show (§68–69).

### Transport and provider changes

- Rekordbox database access is **read-only**. Never add a write path.
- MIDI/FLX4 is secondary truth: hints only, never playhead. `confirmAudible` requires both sources to agree.
- Unknown Rekordbox versions probe but are never declared supported until replay qualification passes (`isSupported` + fixture replay).
- New captures go in `protocol-fixtures/rekordbox/<version>/<os>/<action>/capture.json` with `expectedEvents`; see [docs/rekordbox-capture.md](docs/rekordbox-capture.md).

### Analysis changes

- Native ANLZ always wins timing. ML (all-in-one, beat_this) votes structure/confidence and surfaces `GRID WARNING` — it never silently replaces the grid.
- Keep `analysis/src/autolight_analysis/fusion.py` and the TypeScript `trackModelSchema` in field-by-field parity.
- Optional ML deps stay in the `ml` dependency group so `uv sync` stays light.

### Hardware changes

- Blackout is RGB `0,0,0`, never power-off. White hits are scaled RGB, never CCT mode.
- Per-device FPS backoff only; the logical show stays at 60 Hz.
- Reconnect re-arms and sends the current frame — never replays stale queues.

### Documentation changes

Keep task-oriented information in `docs/` and link new documents from the README documentation table. Update `docs/SPEC.MD` section references when behavior moves.

## Verification matrix

Run the narrowest relevant check while iterating. Before requesting review for a cross-cutting change, run:

```bash
yarn typecheck
yarn test
yarn verify:phase1
cd apps/desktop && yarn test:e2e
```

`yarn verify:phase1` is `typecheck` plus the Python suite. E2E needs Playwright browsers (`yarn playwright install chromium` inside `apps/desktop`).

## Pull request checklist

A review-ready pull request should state:

- the problem and requirement being satisfied;
- the design decision and relevant SPEC sections;
- files and public contracts changed;
- the failing test or reproduction observed before the fix, when applicable;
- exact verification commands and results;
- transport, analysis, fixture, or rollout implications;
- documentation updated;
- anything intentionally not verified (e.g. physical Govee hardware, Windows leg).

Before requesting review:

- [ ] The diff contains only changes needed for the stated goal.
- [ ] Exported symbols and callers are updated together.
- [ ] No mock/demo tracks, fixtures, or BPM in UI or tests.
- [ ] No plaintext secret, credential, or Rekordbox user data is present.
- [ ] Required tests fail for a plausible regression and pass after the change.
- [ ] Typecheck, tests, build, and Python suite pass at the appropriate scope.
- [ ] Renderer/planner golden changes are intentional and explained.
- [ ] No Rekordbox database write path was added.
- [ ] Emergency controls (BLACKOUT) remain modal-free.
