#!/usr/bin/env node
// Probe report (T-QA-01, 02-conformance-matrix.md).
// Maps every probe ID named in the conformance matrix to the file(s) that own
// it, checks each owner exists in the tree, and reports PASS (present) or
// MISSING (absent). Probe behavior itself is asserted by the owner file's own
// tests, never here: this report is the matrix-to-tree wiring. Exits 1 on any
// MISSING so CI stays red until the matrix and the tree agree.
// Run: node tools/conformance-report.mjs.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const matrix = readFileSync(join(root, "docs", "finish", "02-conformance-matrix.md"), "utf8");

// Probe ID -> owning file(s), relative to repo root. A probe passes when at
// least one owner exists. Owners are the exact "Where" from the matrix;
// generic Where text (E2E, SIM, HW runbook, CI job) maps to the harness,
// journey, workflow, or evidence file that carries it.
const PROBES = {
  "P-1-normal-night": ["apps/desktop/e2e/normal-night.spec.ts", "apps/desktop/journeys/night.journey.ts"],
  "P-2.1-future-aware-build": ["packages/show-planner/src/hierarchy.test.ts"],
  "P-2.2-grid-truth": ["packages/rekordbox-library/src/beat.test.ts"],
  "P-2.3-no-dsp-directives": ["analysis/tests/test_readiness.py", "tools/ast-grep/rules/no-echo-ipc.yml"],
  "P-2.4-six-levels": ["packages/show-planner/src/hierarchy.test.ts"],
  "P-2.5-partial-darkness": ["packages/renderer/src/layers.test.ts"],
  "P-2.6-motif-return": ["packages/show-planner/src/recurrence.test.ts"],
  "P-3.1-serato-connect": ["packages/serato/src/remote-provider.test.ts"],
  "P-4.1-readonly-library": ["packages/rekordbox-library/src/db.test.ts"],
  "P-5-anlz-full": ["analysis/tests/test_native_full.py"],
  "P-5.2-pssi-retained": ["packages/rekordbox-library/src/pssi.test.ts"],
  "P-5.3-cues": ["analysis/tests/test_native_full.py"],
  "P-5.4-waveforms": ["analysis/tests/test_native_full.py"],
  "P-5.5-vocal": ["analysis/tests/test_native_full.py"],
  "P-6-provider-contract": ["packages/contracts/src/index.test.ts"],
  "P-7-priority": ["packages/rekordbox-live/src/manager.test.ts"],
  "P-8-lighting-provider": ["packages/rekordbox-live/src/lighting-ipc.test.ts"],
  "P-9.2-surface-inventory": ["docs/finish/evidence/T-LIVE-09/README.md"],
  "P-9.3-matrix-complete": ["protocol-fixtures/rekordbox"],
  "P-9.4-capture-nonempty": ["protocol-fixtures/rekordbox"],
  "P-9.5-decoder-fields": ["packages/rekordbox-live/src/lighting-ipc.test.ts"],
  "P-10-composite": ["packages/rekordbox-live/src/composite.test.ts"],
  "P-11-flx4-map": ["packages/controller-flx4/src/map.test.ts"],
  "P-12-rename-survives": ["packages/track-model/src/index.test.ts"],
  "P-13-uv-only": [".github/workflows/ci.yml"],
  "P-14-kill-worker": ["packages/analysis-client/src/index.test.ts"],
  "P-15-canonical-decode": ["analysis/tests/test_decode.py"],
  "P-16-allinone-session": ["analysis/tests/test_allinone.py"],
  "P-17-grid-warning": ["analysis/tests/test_grid_stems_harmony.py"],
  "P-18-feature-suite": ["analysis/tests/test_features.py"],
  "P-19-provenance": ["packages/contracts/src/index.test.ts"],
  "P-20-trackmodel-v2": ["test-fixtures/analysis/trackmodel-v2.fixture.json"],
  "P-22-event-vocabulary": ["analysis/tests/test_events_full.py"],
  "P-23-build": ["analysis/tests/test_events_full.py"],
  "P-24-drop": ["analysis/tests/test_events_full.py"],
  "P-25-fake-drop": ["analysis/tests/test_events_full.py"],
  "P-26-planner-inputs": ["packages/show-planner/src/schema.test.ts"],
  "P-27-seed-fingerprint": ["packages/show-planner/src/schema.test.ts"],
  "P-28-global-design": ["packages/show-planner/src/identity.test.ts"],
  "P-29-no-timer-colour": ["packages/show-planner/src/styles.test.ts"],
  "P-30-level-rules": ["packages/show-planner/src/hierarchy.test.ts"],
  "P-31-primitive-registry": ["packages/show-planner/src/primitives.test.ts"],
  "P-32-typed-cues": ["packages/contracts/src/index.test.ts"],
  "P-33-layer-stack": ["packages/renderer/src/layers.test.ts"],
  "P-34-restraint": ["packages/show-planner/src/restraint.test.ts"],
  "P-35-contrast": ["packages/show-planner/src/contrast.test.ts"],
  "P-36-drop-sequence": ["packages/show-planner/src/contrast.test.ts"],
  "P-37-variation-fields": ["packages/show-planner/src/recurrence.test.ts"],
  "P-38-fixture-schema": ["packages/contracts/src/index.test.ts"],
  "P-39-cell-mapping": ["packages/venue/src/groups.test.ts"],
  "P-40-cross-device-chase": ["packages/renderer/src/goldens.test.ts"],
  "P-41-derived-groups": ["packages/venue/src/groups.test.ts"],
  "P-42-h6076-discovery": ["packages/simulator/src/govee-lan.test.ts"],
  "P-43-h1a45-topology": ["packages/simulator/src/govee-lan.test.ts"],
  "P-44-toolkit-loaded": ["packages/govee/src/profiles.test.ts"],
  "P-45-profiles": ["packages/govee/src/profiles.test.ts"],
  "P-46-no-power-cycle": ["apps/desktop/electron/services/simulator-show.test.ts"],
  "P-46-razer-bytes": ["packages/govee/src/razer-codec.property.test.ts"],
  "P-47-blackout": ["apps/desktop/electron/services/simulator-show.test.ts"],
  "P-48-white": ["packages/govee/src/actions.test.ts"],
  "P-49-linear-light": ["packages/renderer/src/color.test.ts"],
  "P-50-no-beat-brightness": ["apps/desktop/electron/services/simulator-show.test.ts"],
  "P-51-newest-wins": ["packages/simulator/src/govee-lan.test.ts"],
  "P-52-wizard": ["apps/desktop/journeys/m1-slice.journey.ts"],
  "P-53-resolution": ["packages/simulator/src/govee-lan.test.ts"],
  "P-54-calibration-persist": ["packages/storage/src/migrate.test.ts"],
  "P-55-latency-global": ["packages/renderer/src/index.test.ts"],
  "P-56-ui-freeze": ["apps/desktop/journeys/m1-slice.journey.ts"],
  "P-57-estimator": ["packages/show-runtime/src/estimator.test.ts"],
  "P-58-seek": ["packages/show-runtime/src/seek-equivalence.property.test.ts"],
  "P-59-loop": ["packages/show-runtime/src/runtime.test.ts"],
  "P-60-roll-degrade": ["packages/show-runtime/src/runtime.test.ts"],
  "P-61-scratch": ["packages/show-runtime/src/runtime.test.ts"],
  "P-62-two-worlds": ["packages/show-runtime/src/runtime.test.ts"],
  "P-63-crossfader": ["packages/show-mixer/src/weight.test.ts"],
  "P-64-violet": ["packages/show-mixer/src/blend.test.ts"],
  "P-65-no-leak": ["packages/show-mixer/src/owner.test.ts"],
  "P-65-owner": ["packages/show-mixer/src/owner.test.ts"],
  "P-66-translate-all": ["packages/show-mixer/src/blackout.test.ts"],
  "P-67-introduction": ["packages/show-mixer/src/intro.test.ts"],
  "P-68-audio-dsp": ["packages/reactive-audio/src/dsp.test.ts"],
  "P-69-no-relight": ["packages/reactive-audio/src/overlay.test.ts"],
  "P-70-levels": ["apps/desktop/journeys/m1-slice.journey.ts"],
  "P-71-adaptive": ["packages/show-runtime/src/source-loss.test.ts"],
  "P-72-plan-schema": ["packages/show-planner/src/schema.test.ts"],
  "P-73-beat-domain": ["tools/ast-grep/sgconfig.yml"],
  "P-74-mapping": ["packages/contracts/src/index.test.ts"],
  "P-75-no-device-refs": ["tools/ast-grep/sgconfig.yml"],
  "P-76-pipeline": ["packages/renderer/src/index.test.ts"],
  "P-77-room-wave": ["packages/renderer/src/goldens.test.ts"],
  "P-78-blinder-budget": ["packages/show-planner/src/restraint.test.ts"],
  "P-79-movement-vocabulary": ["packages/show-planner/src/primitives.test.ts"],
  "P-80-db-open": ["packages/storage/src/index.test.ts"],
  "P-81-schema": ["packages/storage/src/migrate.test.ts"],
  "P-82-invalidation": ["packages/storage/src/cache.test.ts"],
  "P-83-layout": ["apps/desktop/src/app/layout.test.ts"],
  "P-85-frozen": [".github/workflows/ci.yml"],
  "P-87-ipc-contract": ["packages/ipc/src/index.test.ts"],
  "P-88-frame-time": ["apps/desktop/journeys/live-session.journey.ts"],
  "P-89-live-layout": ["apps/desktop/src/app/screens.test.ts"],
  "P-90-drop-in-8": ["apps/desktop/journeys/live-session.journey.ts"],
  "P-91-waveform": ["apps/desktop/src/features/inspector/inspector-view.tsx"],
  "P-92-preview-equals-output": ["apps/desktop/journeys/m1-slice.journey.ts"],
  "P-92-snapshot-equals-output": ["apps/desktop/electron/services/simulator-show.test.ts", "apps/desktop/journeys/m1-slice.journey.ts"],
  "P-93-upcoming": ["apps/desktop/journeys/live-session.journey.ts"],
  "P-94-blackout-latency": ["apps/desktop/journeys/m1-slice.journey.ts"],
  "P-95-library": ["apps/desktop/journeys/m1-slice.journey.ts"],
  "P-96-inspector": ["apps/desktop/src/features/inspector/inspector-view.tsx"],
  "P-97-corrections": ["packages/show-planner/src/corrections.test.ts"],
  "P-98-venue-canvas": ["apps/desktop/src/features/venue/venue-view.tsx"],
  "P-99-device-actions": ["apps/desktop/journeys/m1-slice.journey.ts"],
  "P-100-setup": ["apps/desktop/journeys/m1-slice.journey.ts"],
  "P-101-diagnostics": ["apps/desktop/journeys/live-session.journey.ts"],
  "P-102-event-inspector": ["apps/desktop/journeys/live-session.journey.ts"],
  "P-103-replay-exact": ["packages/storage/src/replay.test.ts"],
  "P-104-sim-suite": ["packages/simulator/src/govee-lan.test.ts"],
  "P-105-source-loss": ["packages/show-runtime/src/source-loss.test.ts"],
  "P-106-device-loss": ["packages/simulator/src/govee-lan.test.ts"],
  "P-107-congestion": ["packages/simulator/src/govee-lan.test.ts"],
  "P-108-reload": ["apps/desktop/journeys/soak.journey.ts"],
  "P-110-security": ["apps/desktop/electron/services/secrets-service.test.ts"],
  "P-111-trust": ["apps/desktop/journeys/live-session.journey.ts"],
  "P-112-license-audit": ["tools/license-check.mjs"],
  "P-113-scoring-hook": ["packages/show-planner/src/scoring.test.ts"],
  "P-114-invariants": ["packages/show-planner/src/validator.test.ts"],
  "P-115-diagnostics": ["packages/show-planner/src/validator.test.ts"],
  "P-116-validation-set": ["test-fixtures/analysis/planner-golden.json"],
  "P-117-perf": ["docs/finish/evidence/T-QA-05/measurement.json"],
  "P-118-physical": ["docs/finish/evidence/T-QA-08/README.md"],
  "P-119-sync-matrix": ["tools/qa/sync-matrix.mjs"],
  "P-120-rekordbox-dod": ["packages/rekordbox-live/src/contract-suite.test.ts"],
  "P-121-serato-dod": ["packages/serato/src/serato-dod.test.ts"],
  "P-122-h6076-dod": ["packages/govee/src/qualification.test.ts"],
  "P-123-h1a45-dod": ["packages/govee/src/qualification.test.ts"],
  "P-124-multi-dod": ["packages/govee/src/qualification.test.ts"],
  "P-125-soak": ["docs/finish/evidence/T-QA-06/soak-report.json"],
  "P-126-classes": ["tools/qa/check-classes.mjs"],
  "P-127-goldens": ["packages/show-planner/src/golden.test.ts"],
  "P-128-replay-decodes": ["packages/serato/src/replay.test.ts"],
  "P-129-no-self-write": ["tools/qa/check-goldens.mjs"],
  "P-130-log-schema": ["packages/diagnostics/src/index.test.ts"],
  "P-131-metrics": ["packages/govee/src/metrics.test.ts"],
  "P-132-startup": ["apps/desktop/journeys/m1-slice.journey.ts"],
  "P-133-shutdown": ["apps/desktop/journeys/m1-slice.journey.ts"],
  "P-134-override": ["packages/show-runtime/src/runtime.test.ts"],
  "P-135-styles": ["packages/show-planner/src/styles.test.ts"],
  "P-136-rekordbox-first": ["apps/desktop/src/features/setup/rkbx-setup-panel.test.ts"],
  "P-137-readiness": ["analysis/tests/test_readiness.py"],
  "P-138-fast-path": ["packages/storage/src/fastpath.test.ts"],
  "P-139-queue": ["apps/desktop/journeys/soak.journey.ts"],
  "P-140-upgrade-boundary": ["packages/show-runtime/src/runtime.test.ts"],
  "P-141-watch": ["packages/rekordbox-library/src/watch.test.ts"],
  "P-142-components": ["apps/desktop/src/components/kit.test.ts"],
  "P-143-a11y": ["apps/desktop/journeys/m1-slice.journey.ts"],
  "P-144-no-modal": ["apps/desktop/journeys/night.journey.ts"],
  "P-145-unverified-banner": ["apps/desktop/journeys/live-session.journey.ts"],
  "P-146-registry": ["docs/finish/evidence/T-LIVE-13/README.md"],
  "P-147-unknown-fw": ["packages/simulator/src/govee-lan.test.ts"],
  "P-148-ladder": ["packages/govee/src/qualification.test.ts"],
  "P-151-review": ["docs/finish/evidence/T-QA-13/README.md"],
  "P-153-clean-install": ["docs/finish/evidence/T-OPS-06/README.md"],
  "P-155-boundaries": [".dependency-cruiser.cjs"],
};

const ids = [...new Set([...matrix.matchAll(/`(P-[0-9.]+-[a-z0-9-]+)`/g)].map((m) => m[1]))];
let missing = 0;
let pass = 0;
const missingIds = [];
for (const id of ids.sort()) {
  const owners = PROBES[id];
  if (!owners) {
    console.log(`${id}: UNMAPPED (no owner in conformance-report.mjs)`);
    missing++;
    missingIds.push(id);
    continue;
  }
  const found = owners.filter((f) => existsSync(join(root, f)));
  if (found.length === 0) {
    console.log(`${id}: MISSING (none of ${owners.join(", ")} exists)`);
    missing++;
    missingIds.push(id);
    continue;
  }
  console.log(`${id}: PASS (${found[0]})`);
  pass++;
}
console.log(`probe report: ${pass}/${ids.length} mapped and present`);
if (missing > 0) {
  console.error(`probe report: ${missing} MISSING or UNMAPPED: ${missingIds.join(", ")}`);
  process.exit(1);
}
console.log("probe report: matrix and tree agree");
