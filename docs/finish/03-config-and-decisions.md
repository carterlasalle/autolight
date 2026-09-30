# 03. Configuration system and decision switches (WP01)

The owner's instruction: every configuration is visible, nothing is hardcoded,
anything that must be fixed lives in a config file, and every decision between
approaches is implemented in all its forms plus a combined form, with the
switch visible.

## 1. Principles

1. **One registry.** Every tunable is declared once in `packages/config`
   (new) with its type, default, unit, range, description, scope, spec
   reference, receipt, live-safety and UI placement. Nothing reads a tunable
   from anywhere else.
2. **Layered values.** Resolution order, lowest to highest precedence:
   built-in default, user app settings, venue settings, device settings,
   style settings (for planner keys), temporary session override (from the
   Live screen). The UI always shows which layer supplied the effective value.
3. **Receipts.** Every default carries a receipt: `spec` (value mandated by
   SPEC with section number), `upstream` (measured by an upstream project, with
   file and line), `measured` (measured by us, with evidence path), or
   `unmeasured` (a starting guess that a named task must measure). AGENTS.md
   section 9 applies: no receipt, no empirical number.
4. **Invariants are not settings.** Spec prohibitions (blackout never powers
   off, cloud never carries frames, no modal during Live, DJ grid wins) are
   code invariants with runtime assertions, not configuration. They are listed
   read-only in Settings under "Guarantees" so the owner can see them.
5. **Protocol constants are data.** Opcodes, UUIDs, multicast groups, packet
   offsets and similar live in `packages/<transport>/protocol/*.json` (one
   file per protocol) with a `source` citation per constant, shown read-only in
   Settings under "Protocol constants". Ports are ordinary settings because
   networks vary.
6. **Decision switches are settings with a `decision` flag.** They appear in
   their own Settings tab, in the status bar (compact indicator of active
   modes) and in Diagnostics with the measurements that let the owner choose.
7. **Live safety.** Each key declares `liveSafe`. Live-safe keys apply at the
   next bar (or immediately for emergency keys). Unsafe keys are queued while
   Live is active and applied when the owner leaves Live or confirms (the
   confirmation is a non-modal inline control, spec 144).
8. **Python shares the registry.** The registry exports JSON Schema and a
   resolved JSON document; the analysis worker validates it with pydantic
   (added with `uv add pydantic`) and receives the resolved `analysis.*`
   subtree at start and with each job. The config hash is part of the analysis
   cache key.

## 2. Tasks

### T-CFG-01 Create `@autolight/config`

- Closes: F-CFG-02, F-DATA-08.
- Build `packages/config` with a `defineKey()` API. Each key:
  `{ key, schema (Zod), default, unit, min?, max?, enum?, description, scope: "app"|"venue"|"device"|"style"|"session", specRef?, receipt: {kind, ref}, liveSafe, restartRequired, uiGroup, uiOrder, decision?: DecisionMeta, owner (package) }`.
- Export: typed accessors (`cfg.get("govee.lan.discovery.retryInitialMs")` with
  the value type inferred), a JSON Schema export, a markdown export
  (`docs/config-reference.md`, generated, committed, checked in CI), and a JSON
  defaults export for Python.
- DoD:
  1. Every key in section 3 below exists in the registry with the stated
     default and receipt.
  2. `yarn workspace @autolight/config run export` regenerates
     `docs/config-reference.md` and `analysis/src/autolight_analysis/config_schema.json`;
     CI fails if they are stale.
  3. Type test: reading an undefined key is a compile error.
- Metric: registry size printed in CI; zero keys without receipt.

### T-CFG-02 Layered resolution and persistence

- Closes: F-CFG-02, F-DATA-08.
- Store layers in the app database (`settings` table: `scope`, `scope_id`,
  `key`, `value_json`, `updated_at`, `updated_by`). Import and export the full
  effective configuration as one JSON file from Settings. Validation errors
  name the key, the value, the allowed range and the fix (AGENTS.md section 10).
- Change events: main publishes `config:changed` with the diff; the show host,
  providers, transports and the Python supervisor subscribe.
- DoD:
  1. Integration test: set a device-scope value, restart the app, value
     persists and wins over the app scope.
  2. Invalid import is rejected with a message naming every bad key.
  3. Live-safe change applies at the next bar (runtime test measures it);
     unsafe change is queued with a visible pending indicator (E2E).

### T-CFG-03 Python config bridge

- Closes: F-CFG-01 (analysis part).
- `uv add pydantic` in `analysis/`. Generate pydantic models from the JSON
  Schema at build time (committed, checked for staleness) or validate against
  the schema at worker start. Every constant in the Python pipeline is read
  from the resolved config. The config hash goes into the artifact metadata
  and the cache key (T-ANA-13).
- DoD: ast-grep (Python) or Ruff rule flags numeric literals in
  `autolight_analysis/{structure,events,features,stems,fusion,metrical}.py`
  outside a small allowlist (0, 1, -1, array index arithmetic); CI green.

### T-CFG-04 Extract every hardcoded value

- Closes: F-CFG-01, F-PLAN-17, F-AUD-04, plus the literals behind F-GOV-11.
- Add ast-grep rule `no-magic-number` for TypeScript packages
  `show-*`, `renderer`, `venue`, `govee`, `dj-core`, `reactive-audio`,
  `rekordbox-*`, `serato`, `controller-flx4`, `analysis-client`, `apps/desktop/electron`.
  Allowed: `0`, `1`, `-1`, `2` in arithmetic, array index math, bit masks
  inside protocol codecs that cite a protocol constants file. Everything else
  goes to the registry or a protocol constants file.
- Migrate every value listed in section 3. Search again with the rule until it
  reports zero findings.
- DoD: rule at `blocking` in CI with zero findings; section 3 table complete.

### T-CFG-05 Settings UI

- Closes: F-UI-17, F-CFG-02.
- Settings screen (sidebar entry, also reachable from the command palette):
  - search by key, description or spec section;
  - groups by module with the registry's `uiGroup` and `uiOrder`;
  - each row shows effective value, default, unit, range, the layer that
    supplied it (badge), receipt kind (badge: spec, upstream, measured,
    unmeasured), description, live-safe marker, reset to default, and a diff
    indicator when not default;
  - tabs: All, Decision switches, Protocol constants (read-only), Guarantees
    (read-only invariants), Per-venue, Per-device;
  - import and export buttons; "show only changed" filter.
- DoD: E2E test changes one key in each scope, sees it applied, resets it;
  screenshot evidence; axe-core has no serious violations.

### T-CFG-06 Decision switch framework

- Closes: F-DEC-01.
- Each decision in section 4 is a registry key with `decision` metadata:
  options (each with a short explanation, pros, cons, requirements), the
  combined option, the default and the metrics that inform the choice.
- The Decision switches tab shows, per switch: current mode, available modes
  (disabled with reason when a requirement is missing, for example "rkbx_link
  not detected on port 4460"), and a live metrics panel comparing modes where
  they can run side by side (for example the fusion provider shows per-source
  beat error and update rate).
- Status bar: a compact indicator per active non-default switch.
- DoD: every DS in section 4 has all listed options implemented and reachable
  from the UI; an E2E test flips each switch and asserts the runtime reports
  the new mode; each DS has a comparison measurement in its evidence folder.

### T-CFG-07 Live-mode change safety

- Closes: part of spec 144 and 140.
- Implement the live-safe policy from section 1.7 in the show host and the UI.
- DoD: runtime test proves no frame discontinuity greater than one tick when a
  live-safe planner key changes mid-phrase (the change lands on the next bar);
  E2E proves an unsafe key is queued and applied on leaving Live.

## 3. Configuration key catalog

This is the starting catalog. It covers every hardcoded value found in the
repository on 2026-09-30 plus the values the new work needs. When you find a
literal not listed here, add it. `R:` is the receipt. `LS` is live-safe
(Y or N).

### 3.1 Show host and clock

| Key | Default | Unit | Range | R | LS |
| --- | --- | --- | --- | --- | --- |
| `runtime.host` | `worker-thread` | enum DS-07 | see DS-07 | spec 56 | N |
| `runtime.clock.tickHz` | 60 | Hz | 30 to 120 | spec 117 | N |
| `runtime.clock.timerStrategy` | `hybrid` | enum DS-08 | see DS-08 | unmeasured (T-ARC-06) | N |
| `runtime.clock.spinWindowMs` | 1.5 | ms | 0 to 5 | unmeasured (T-ARC-06) | N |
| `runtime.snapshot.uiRateHz` | 30 | Hz | 10 to 60 | unmeasured (T-ARC-04) | Y |
| `runtime.snapshot.maxBytes` | 262144 | bytes | 16384 to 4194304 | unmeasured (T-ARC-04) | Y |
| `runtime.crash.holdMs` | 2000 | ms | 0 to 30000 | unmeasured (T-ARC-03) | Y |
| `runtime.estimator.correctionGain` | 0.15 | ratio per tick | 0.01 to 1 | unmeasured (T-RUN-02) | Y |
| `runtime.estimator.maxSlewBeatsPerSec` | 0.08 | beats/s | 0 to 1 | unmeasured (T-RUN-02) | Y |
| `runtime.estimator.maxErrorMs` | 20 | ms | 1 to 200 | unmeasured target | Y |
| `runtime.seek.thresholdBeats` | 0.5 | beats | 0.1 to 16 | unmeasured (was 8, `show-runtime/src/index.ts:42`) | Y |
| `runtime.seek.thresholdMs` | 150 | ms | 10 to 2000 | unmeasured (was 250, `dj-core/src/index.ts:12`) | Y |
| `runtime.scratch.rateDeviation` | 0.5 | ratio | 0.05 to 2 | unmeasured (T-RUN-05) | Y |
| `runtime.scratch.minReversalsPerSec` | 2 | 1/s | 0 to 20 | unmeasured | Y |
| `runtime.scratch.resyncAt` | `bar` | enum beat, bar, phrase | | spec 61 "next sensible boundary" | Y |
| `runtime.loop.variation` | `alternate-ab` | enum none, alternate-ab, rotate-3 | | spec 59 | Y |
| `runtime.roll.degradeOrder` | `["pulse","contraction","impact"]` | list | | spec 60 | Y |
| `runtime.health.extrapolateMs` | 500 | ms | | spec 105 | Y |
| `runtime.health.holdMs` | 2000 | ms | | spec 105 | Y |
| `runtime.override.resumeDefault` | `bar` | enum | beat, bar, phrase, immediate | spec 134 | Y |
| `runtime.override.whiteIntensity` | 1.0 | ratio | 0 to 1 | spec 48 | Y |
| `runtime.override.masterIntensity` | 1.0 | ratio | 0 to 1 | spec 94 | Y |
| `runtime.fastPath.budgetMs` | 100 | ms | | unmeasured target (spec 138 "instantly") | N |
| `runtime.upgrade.boundary` | `phrase` | enum section, phrase, bar | | spec 140 | Y |
| `ops.startup.budgetMs` | 10000 | ms | 1000 to 60000 | unmeasured target (spec 132) | N |
| `runtime.adaptive.phraseBeats` | 32 | beats | 8 to 64 | unmeasured | Y |
| `runtime.adaptive.cooldownPhrases` | 2 | phrases | 0 to 8 | was 2 (`reactive-audio/src/index.ts:35`) | Y |
| `runtime.adaptive.engine` | `combined` | enum DS-28 | | owner | Y |
| `runtime.adaptive.minLooks` | 24 | count | 1 to 500 | unmeasured | Y |

### 3.2 Mixer and renderer

| Key | Default | Unit | Range | R | LS |
| --- | --- | --- | --- | --- | --- |
| `mixer.crossfader.curve` | `source` | enum source, linear, constant-power, sharp-cut | | spec 63 | Y |
| `mixer.crossfader.assignment` | `{ "1": "A", "2": "B", "3": "THRU", "4": "THRU" }` | map | A, B, THRU | spec 63 | Y |
| `mixer.weight.masterBonus` | 0.1 | ratio | 0 to 0.5 | unmeasured | Y |
| `mixer.intro.paletteAt` | 0.05 | weight | 0 to 1 | was hardcoded (`show-mixer/src/index.ts:31`) | Y |
| `mixer.intro.rhythmAt` | 0.3 | weight | 0 to 1 | was hardcoded | Y |
| `mixer.intro.impactsAt` | 0.7 | weight | 0 to 1 | was hardcoded | Y |
| `mixer.blackout.policy` | `auto` | enum DS-18 | | spec 66 | Y |
| `mixer.blackout.otherDeckThreshold` | 0.3 | weight | 0 to 1 | was hardcoded (`show-mixer/src/index.ts:25`) | Y |
| `mixer.owner.hysteresis` | 0.1 | ratio | 0 to 0.5 | unmeasured | Y |
| `mixer.owner.factorWeights` | `{ weight: 1, master: 0.3, confidence: 0.5, strength: 1, significance: 0.5 }` | map | | unmeasured (spec 65 factors) | Y |
| `mixer.blendSpace` | `oklab-hue-linear-intensity` | enum DS-09 | | spec 64 (combined mode) | Y |
| `render.gammaDefault` | 2.2 | exponent | 1 to 3 | spec 49 approximation; per device from calibration | Y |
| `render.antialias.subCell` | true | bool | | owner room request | Y |
| `render.singleZone.representative` | `area-weighted-mean-oklab` | enum mean-linear, area-weighted-mean-oklab, dominant, center-cell | | unmeasured | Y |
| `render.latency.mode` | `measured-else-sku` | enum DS-17 | | spec 55 | Y |
| `render.impact.defaultMs` | 90 | ms | 20 to 500 | spec 36 example | Y |
| `render.strobe.maxHz` | 12 | Hz | 1 to 30 | unmeasured; also capped by fixture fps | Y |
| `render.tickBudgetMs` | 4 | ms per tick (2,000 cells, two decks) | 1 to 16 | unmeasured target | N |

### 3.3 Planner (style layer can override)

| Key | Default | Unit | R | LS |
| --- | --- | --- | --- | --- |
| `planner.version` | read-only | string | code | N |
| `planner.mode` | `rules-with-veto` | enum DS-19 | spec 113 (combined mode) | N |
| `planner.sectionEnergy` | `{intro:.3, verse:.45, prechorus:.6, build:.8, drop:1, chorus:.9, breakdown:.25, bridge:.5, instrumental:.6, solo:.7, outro:.3, transition:.5, unknown:.5}` | map | was `SECTION_ENERGY` (`show-planner/src/index.ts:65-69`) | Y |
| `planner.drop.minConfidence` | 0.5 | ratio | unmeasured | Y |
| `planner.drop.stages` | `[8,8,8,4,4]` | beats list | spec 36 example | Y |
| `planner.drop.preDarknessBeats` | 1 | beats | spec 35, 36 | Y |
| `planner.drop.burstBeats` | 2 | beats | spec 36 | Y |
| `planner.restraint.whiteHitMinBeats` | 16 | beats | was 8, now a registry key | Y |
| `planner.restraint.blackoutMinBeats` | 32 | beats | unmeasured | Y |
| `planner.restraint.strobeMaxDuty` | 0.08 | ratio | unmeasured | Y |
| `planner.restraint.paletteChangeMinBeats` | 16 | beats | spec 114 | Y |
| `planner.restraint.patternRepeatMax` | 4 | count | unmeasured | Y |
| `planner.restraint.sectionImpactMax` | 3 | count | unmeasured | Y |
| `planner.restraint.trackImpactMax` | 12 | count | unmeasured | Y |
| `planner.contrast.breakdownMaxMean` | 0.3 | ratio | unmeasured | Y |
| `planner.recurrence.similarityThreshold` | 0.8 | cosine | unmeasured | Y |
| `planner.candidates.perSection` | 4 | count | DS-19 | Y |
| `planner.chase.basePeriodBeats` | 8 | beats | was hardcoded | Y |
| `planner.palette.minDistance` | 0.12 | OKLab distance | unmeasured | Y |
| `planner.events.minConfidence` | per event type map, 0.5 default | ratio | unmeasured | Y |
| `planner.evaluation.bounds` | map of the ten spec 115 diagnostics to allowed ranges | map | unmeasured | Y |
| `planner.compile.budgetMs` | 2000 | ms p95 | unmeasured target | N |
| `planner.validation.rejectOn` | `["exclusive-overlap","negative-duration","out-of-range","unsupported-capability"]` | list | spec 114 | N |

### 3.4 Live audio

| Key | Default | Unit | R | LS |
| --- | --- | --- | --- | --- |
| `audio.capture.host` | `audio-window` | enum DS-14 | owner | N |
| `audio.capture.deviceId` | `""` (none) | string | user | Y |
| `audio.fftSize` | 2048 | samples | unmeasured | N |
| `audio.melBands` | 24 | count | unmeasured | N |
| `audio.agc.rise` | 0.3 | ratio | was hardcoded (`reactive-audio/src/index.ts:11`) | Y |
| `audio.agc.decay` | 0.05 | ratio | was hardcoded | Y |
| `audio.agc.target` | 0.5 | ratio | was hardcoded | Y |
| `audio.onset.threshold` | 1.5 | z-score | unmeasured | Y |
| `audio.overlay.cap` | 0.2 | ratio | was `MAX_OVERLAY_GAIN`; final amount = cap times `style.reactiveAmount` | Y |

### 3.5 Analysis (Python reads these)

| Key | Default | Unit | R | LS |
| --- | --- | --- | --- | --- |
| `analysis.worker.concurrency` | 1 | jobs | unmeasured | N |
| `analysis.worker.restartBackoffMs` | `[1000, 30000]` | ms min/max | unmeasured | N |
| `analysis.worker.jobTimeoutMs` | 900000 | ms | unmeasured | N |
| `analysis.worker.heartbeatMs` | 5000 | ms | unmeasured | N |
| `analysis.cacheDir` | `<userData>/analysis-cache` | path | spec 82 | N |
| `analysis.device` | `auto` | enum auto, cpu, cuda | spec 16 | N |
| `analysis.ml.enabled` | true | bool | spec 16 | N |
| `analysis.ml.modelCacheDir` | `<userData>/models` | path | T-ANA-05 | N |
| `analysis.ml.offlineOnly` | true during Live | bool | spec 110 | N |
| `analysis.stems.mode` | `fusion` | enum DS-10 | owner | N |
| `analysis.structure.mode` | `fused` | enum DS-11 | spec 19 | N |
| `analysis.metrical.mode` | `both` | enum DS-12 | spec 17 | N |
| `analysis.frame.hop` | 512 | samples | unmeasured (was 1024) | N |
| `analysis.frame.size` | 2048 | samples | was hardcoded | N |
| `analysis.bands` | `{bass:[20,150], lowMid:[150,500], mid:[500,2000], high:[2000,20000]}` | Hz | was hardcoded (`stems.py:51-59`) | N |
| `analysis.build.windows` | `[8,16,32]` | beats | spec 23 | N |
| `analysis.drop.minJump` | 0.25 | relative | was hardcoded (`structure.py:81`) | N |
| `analysis.drop.minVotes` | 3 | count | was hardcoded | N |
| `analysis.drop.minConfidence` | 0.6 | ratio | was hardcoded | N |
| `analysis.silence.level` | 0.05 | ratio of max | was hardcoded (`worker.py:47`) | N |
| `analysis.fakeDrop.gapBeats` | `[1,4]` | beats | spec 25 | N |
| `analysis.gridWarning.toleranceMs` | 50 | ms | was 0.05 s | N |
| `analysis.gridWarning.minAnchors` | 32 | count | unmeasured | N |
| `analysis.decode.resampler` | `soxr` | enum soxr, swr | unmeasured | N |
| `analysis.beatthis.invoke` | `api` | enum api, cli | upstream README | N |
| `analysis.aggregate.subdivisions` | 4 | per beat | unmeasured | N |
| `analysis.stems.keepAudio` | false | bool | disk budget | N |

### 3.6 Govee LAN

| Key | Default | Unit | R | LS |
| --- | --- | --- | --- | --- |
| `govee.lan.engine` | `auto` | enum DS-02 | owner | N |
| `govee.lan.ports.scan` | 4001 | port | Govee WLAN guide | N |
| `govee.lan.ports.reply` | 4002 | port | Govee WLAN guide | N |
| `govee.lan.ports.control` | 4003 | port | Govee WLAN guide | N |
| `govee.lan.interfaces` | `[]` (all eligible) | list of interface names | spec 111 | N |
| `govee.lan.discovery.multicast` | true | bool | govee2mqtt `lan_api.rs` | N |
| `govee.lan.discovery.perInterfaceBroadcast` | true | bool | govee2mqtt | N |
| `govee.lan.discovery.globalBroadcast` | true | bool | govee2mqtt | N |
| `govee.lan.discovery.scanList` | `[]` | IPs or hostnames | govee2mqtt `GOVEE_LAN_SCAN` | N |
| `govee.lan.discovery.retryInitialMs` | 2000 | ms | govee2mqtt `lan_api.rs:521` | Y |
| `govee.lan.discovery.retryMaxMs` | 60000 | ms | govee2mqtt `lan_api.rs:522` | Y |
| `govee.lan.discovery.backgroundRescanMs` | 30000 | ms | unmeasured (Lightwave 15 s, HA 300 s) | Y |
| `govee.lan.status.retryMs` | 350 | ms | govee2mqtt `lan_api.rs:605` | Y |
| `govee.lan.status.deadlineMs` | 10000 | ms | govee2mqtt `lan_api.rs:601` | Y |
| `govee.lan.arm.settleMsDefault` | 50 | ms | toolkit measurements default | N |
| `govee.lan.stream.fallbackHz` | 10 | Hz | toolkit `FALLBACK_HZ` | N |
| `govee.lan.stream.targetHz` | 60 | Hz | spec 117 logical rate; per device capped by qualification | N |
| `govee.lan.stream.keepaliveMs` | 0 (off) | ms | only if qualification shows the unit drops an idle stream | N |
| `govee.lan.stream.maxRearmAttempts` | 3 | count | unmeasured (spec 147 "do not spam") | Y |
| `govee.lan.stream.rearmWindowMs` | 60000 | ms | unmeasured | Y |
| `govee.lan.command.minSpacingMs` | 40 | ms | unmeasured (toolkit: third back-to-back command dropped) | N |
| `govee.lan.reconnect.maxMs` | 5000 | ms | unmeasured target | Y |
| `govee.lan.backoff.minFps` | 5 | fps | was hardcoded (`govee/src/index.ts:213`) | Y |
| `govee.brightness.maxPerMinute` | 6 | commands | unmeasured (spec 50 "slow") | Y |
| `govee.identify.flashMs` | 1000 | ms | comment intent in `show-service.ts:101` | Y |
| `govee.testChase.stepMs` | 150 | ms | unmeasured | Y |

### 3.7 BLE, Matter, cloud, failover

| Key | Default | Unit | R | LS |
| --- | --- | --- | --- | --- |
| `govee.ble.backend` | `auto` | enum DS-04 | owner | N |
| `govee.ble.encryptedLink` | `auto` | enum DS-05 | owner decision | N |
| `govee.ble.writeBudgetHzDefault` | 100 | Hz | toolkit `devices/H61A0.yaml:273` (one unit) | N |
| `govee.ble.writeDrainMsDefault` | 300 | ms | unmeasured (toolkit says measure per unit) | N |
| `govee.ble.scanTimeoutMs` | 10000 | ms | unmeasured | Y |
| `govee.ble.colorQuantizeLevels` | 0 (off) | levels per channel | unmeasured | Y |
| `govee.ble.hostColorChannel` | true | bool | toolkit ble.md section 8 | Y |
| `govee.matter.enabled` | false | bool | owner decision per device | N |
| `govee.matter.commandRateHz` | 10 | Hz | unmeasured | Y |
| `govee.cloud.enabled` | false | bool | spec 148 | N |
| `govee.cloud.perDevicePerMinute` | 10 | requests | Govee docs via toolkit `cloud.md:102` | N |
| `govee.cloud.perAccountPerDay` | 10000 | requests | Govee docs via toolkit `cloud.md:101` | N |
| `govee.failover.policy` | `hybrid` | enum DS-03 | owner | N |
| `govee.failover.lanLossMs` | 3000 | ms | unmeasured | Y |
| `govee.failover.probeIntervalMs` | 10000 | ms | unmeasured | Y |
| `govee.device.<fixtureId>.transportMode` | `hybrid` | enum DS-31 | owner (per device) | Y (switch applied at the next bar) |
| `govee.device.<fixtureId>.transportOrder` | `["lan-razer","ble-segmented","lan-json","ble-single","matter"]` | ordered list | spec 148 | Y |

### 3.8 DJ sources

| Key | Default | Unit | R | LS |
| --- | --- | --- | --- | --- |
| `live.provider` | `fusion` | enum DS-01 | owner | N |
| `live.provider.staleMs` | 500 | ms | spec 105 | Y |
| `live.rkbx.oscBind` | `127.0.0.1:4460` | host:port | rkbx_link README default destination | N |
| `live.rkbx.configPath` | `""` | path to user's rkbx_link folder | user | N |
| `live.prolink.mode` | `passive` | enum DS-29 | owner | N |
| `live.prolink.deviceNumber` | 7 | 1 to 15 | unmeasured (must not collide with real players) | N |
| `live.prolink.keepaliveMs` | 1500 | ms | dysentery analysis | N |
| `live.prolink.peerExpiryMs` | 5000 | ms | unmeasured | Y |
| `live.ax.intervalMs` | 250 | ms | unmeasured (was 1000) | Y |
| `live.ax.timeoutMs` | 2000 | ms | unmeasured (was 8000) | Y |
| `live.agentApi.port` | 30001 | port | rkbx_os2l README, capture log | N |
| `live.os2l.enabled` | true | bool | owner notes | N |
| `live.link.enabled` | true | bool | spec 10 | N |
| `live.link.quantum` | 4 | beats | Ableton Link default | Y |
| `live.memoryReader.enabled` | false | bool | owner consent required | N |
| `live.memoryReader.offsetsFile` | `<userData>/offsets/rekordbox.json` | path | T-LIVE-11 | N |
| `live.lighting.enabled` | true | bool | spec 7 | N |
| `live.fusion.authority` | `["lighting-ipc","memory-cleanroom","rkbx-osc","prolink","composite-flx4","ax","os2l"]` | ordered list | spec 7 extended by owner | Y |
| `live.fusion.disagreeBeats` | 0.25 | beats | unmeasured | Y |
| `live.fusion.switchHoldMs` | 500 | ms | unmeasured | Y |
| `live.rkbx.playingEpsilonMs` | 5 | ms | unmeasured | Y |
| `live.rkbx.pauseHoldMs` | 150 | ms | unmeasured | Y |
| `live.prolink.interfaces` | `[]` (all eligible) | list | spec 111 | N |
| `live.ax.cpuBudgetPercent` | 3 | percent | unmeasured | Y |
| `live.composite.openFilePollMs` | 500 | ms | unmeasured | Y |
| `live.composite.correlationWindowMs` | 4000 | ms | unmeasured | Y |
| `live.composite.lockedErrorMs` | 15 | ms | unmeasured target | Y |
| `live.link.mode` | `auto` | enum DS-36 | license constraint | N |
| `live.link.publish` | false | bool | owner | Y |
| `flx4.backend` | `auto` | enum DS-13 | owner | N |
| `flx4.portMatch` | `DDJ-FLX4` | regex | device name | N |
| `flx4.tempoRange` | `source` | enum source, 6, 10, 16, wide | Rekordbox tempo range setting | Y |
| `flx4.hotplugPollMs` | 2000 | ms | unmeasured | Y |
| `flx4.hints.filterWindowMs` | 1500 | ms | unmeasured | Y |
| `flx4.hints.enabled` | all hint types | list | spec 11 | Y |
| `serato.remote.enabled` | true | bool | spec 3.1 | N |
| `serato.master.inferHoldMs` | 750 | ms | unmeasured | Y |
| `library.rekordbox.reader` | `auto` | enum DS-15 | owner | N |
| `library.watch.debounceMs` | 2000 | ms | unmeasured | Y |
| `library.watch.engine` | `auto` | enum DS-35 | owner | N |
| `library.watch.pollMs` | 60000 | ms | unmeasured | Y |
| `library.fileHash.strategy` | `full` | enum full, sampled | spec 12 | N |
| `library.rekordbox.dbPath` | auto-detected | path | rekordbox-connect detection | N |
| `library.rekordbox.optionsPath` | auto-detected | path | rekordbox-connect detection | N |
| `library.rekordbox.sharePath` | auto-detected | path | rekordbox-connect detection | N |
| `library.rekordbox.crossCheck` | true | bool | DS-15 combined mode | N |
| `library.serato.root` | auto-detected (`~/Music/_Serato_`) | path | serato-connect, Serato docs | N |
| `identity.fingerprint.mode` | `both` | enum DS-34 | spec 12 | N |
| `identity.fingerprint.acousticThreshold` | 0.9 | similarity | unmeasured | N |
| `contracts.mapping.benchMs` | 250 | ms per million mappings | unmeasured target | N |

### 3.9 Room and venue

| Key | Default | Unit | R | LS |
| --- | --- | --- | --- | --- |
| `room.distanceMetric` | `auto` | enum DS-24 | owner room request | Y |
| `room.perimeter.zero` | `dj-nearest` | enum DS-25 | owner room request | Y |
| `room.perimeter.direction` | `clockwise` | enum clockwise, counterclockwise | owner | Y |
| `room.pivot` | `room-center` | enum room-center, dj, anchor id | owner | Y |
| `room.sides.centerBandWidth` | 0.15 | fraction of room width | unmeasured | Y |
| `room.splits.defaultAngleDeg` | 0 | degrees from DJ facing | owner | Y |
| `room.splits.mode` | `blend` | enum DS-33 | owner room request | Y |
| `room.splits.featherMeters` | 0.25 | m | unmeasured | Y |
| `room.zones.featherMeters` | 0.2 | m | unmeasured | Y |
| `room.orbit.path` | `auto` | enum DS-32 | owner room request | Y |
| `room.orientation.leftRightFrom` | `dj` | enum dj, audience | spec 40 | Y |
| `room.nearDj.radiusMeters` | 1.5 | m | unmeasured | Y |
| `venue.spline.toleranceMeters` | 0.005 | m | unmeasured | N |
| `venue.fields.budgetMs` | 20 | ms for 2,000 cells | unmeasured target | N |

### 3.10 Storage, diagnostics, security, updates

| Key | Default | Unit | R | LS |
| --- | --- | --- | --- | --- |
| `storage.driver` | `auto` | enum DS-06 | owner | N |
| `storage.sqlite.synchronous` | `NORMAL` | enum OFF, NORMAL, FULL | SQLite WAL guidance | N |
| `storage.sqlite.busyTimeoutMs` | 5000 | ms | unmeasured | N |
| `ops.safeState.look` | `ending-look` | enum hold-last, ending-look, blackout | spec 133 | Y |
| `diagnostics.mode` | `normal` | enum normal, diagnostic | spec 102, 130 | Y |
| `diagnostics.log.maxFileMb` | 10 | MB | unmeasured | N |
| `diagnostics.log.files` | 5 | count | unmeasured | N |
| `diagnostics.recorder.enabled` | false | bool | spec 103 | Y |
| `diagnostics.recorder.maxMb` | 512 | MB | unmeasured | N |
| `security.cloudAllowed` | false | bool | spec 110 | N |
| `update.checkOnLaunch` | false | bool | spec 145 | N |
| `update.neverDuringLive` | read-only invariant | | spec 145 | N |
| `ui.shortcuts.*` | B blackout, W white, F freeze, A auto, M manual, Up and Down master, 1 to 9 presets | map | spec 94 | Y |
| `ui.shortcuts.whiteMode` | `hold` | enum hold, toggle | owner | Y |
| `ui.live.minTimingFontPx` | 48 | px | spec 143 | Y |
| `ui.live.minBodyFontPx` | 16 | px | spec 143 | Y |

### 3.11 QA and verification

| Key | Default | Unit | R | LS |
| --- | --- | --- | --- | --- |
| `qa.events.toleranceBeats` | 1 | beats | unmeasured target | N |
| `qa.events.minRecall` | per event type map, 0.8 default | ratio | unmeasured target | N |
| `qa.events.minPrecision` | per event type map, 0.7 default | ratio | unmeasured target | N |
| `qa.key.minAccuracy` | 0.7 | ratio | unmeasured target | N |
| `qa.replay.timeToleranceMs` | 5 | ms | unmeasured target | N |
| `qa.faults.*` | scenario parameter maps | map | spec 104 to 107 | N |
| `qa.perf.ciSlack` | 3 | multiplier on reference thresholds | CI runner variance | N |
| `qa.soak.maxMemSlopeMbPerHour` | 5 | MB per hour | spec 125 "no growth trend" | N |
| `qa.soak.maxLatencySlopeMsPerHour` | 1 | ms per hour | spec 125 | N |
| `qa.sync.maxBeatErrorMs` | 20 | ms p95 | unmeasured target | N |
| `qa.validation.minPerCategory` | 3 | tracks | spec 116 | N |

## 4. Decision switch catalog

Each switch is implemented in every listed mode. "Combined" is the mode that
takes the best of each; it is usually the default. The owner decides later
with the measurements listed. None of these options may be removed.

| DS | Decision | Modes to implement | Combined mode | Default | Measurements shown | Tasks |
| --- | --- | --- | --- | --- | --- | --- |
| DS-01 | Rekordbox live source | `rkbx-osc` (rkbx_link sidecar over OSC), `lighting-ipc` (decoded SoundSwitch Lighting protocol), `prolink` (PRO DJ LINK), `ax` (accessibility scrape), `composite-flx4` (library + FLX4 + Link + audio correction), `memory-cleanroom` (own reader), `os2l` (OS2L input) | `fusion`: runs every available source, ranks fields by authority (lighting, memory, rkbx, prolink, composite, ax, os2l by default), cross-validates, switches authority with hysteresis, labels every field's source | `fusion` | Per source: update rate, beat error against the chosen authority, state age, fields provided, dropouts | T-LIVE-02 to T-LIVE-11 |
| DS-02 | Govee LAN stream engine | `toolkit` (govee-toolkit napi binding), `native-ts` (our TypeScript razer codec on our sockets) | `auto`: toolkit primary; native-ts when the addon fails to load or per device when the toolkit reports errors; both tested for byte parity | `auto` | Frames sent, superseded, send time, errors per engine | T-GOV-01 to T-GOV-03 |
| DS-03 | Transport failover | `strict` (explicit per-fixture mode list, never switches; toolkit stance), `auto` (fastest verified transport for everything; govee-homeassistant stance) | `hybrid`: auto for state and whole-fixture colour; segment frames only on verified segmented transports; every switch shown in the UI | `hybrid` | Time to failover, frames lost, transport per fixture | T-FOV-01, T-FOV-02 |
| DS-04 | BLE backend | `toolkit-ble` (btleplug inside govee-toolkit), `noble` (@stoprocent/noble, our codec) | `auto`: toolkit when available, noble otherwise or per device | `auto` | Connect time, write success, pacing adherence | T-BLE-01 |
| DS-05 | BLE encrypted link | `off`, `on` (always attempt handshake) | `auto`: handshake only when the advertisement sets bit 0x40 or the version characteristic reports v2 | `auto` (owner confirms shipping keys) | Handshake success per device | T-BLE-07 |
| DS-06 | Storage driver | `better-sqlite3` (spec 80), `node-sqlite` (built-in) | `auto`: better-sqlite3, falling back to node:sqlite if the native module cannot load | `auto` | Open time, write latency p99 | T-DATA-01 |
| DS-07 | Show host placement | `worker-thread` (Node worker thread in main), `utility-process` (Electron utilityProcess) | `utility-process-worker`: utilityProcess whose render loop runs on its own worker thread | `worker-thread` (spec 56) | Tick jitter under main-process load and renderer freeze | T-ARC-01 |
| DS-08 | Clock timer strategy | `interval` (drift-corrected setInterval), `timeout-spin` (setTimeout plus busy-wait tail) | `hybrid`: `Atomics.wait` coarse sleep plus spin for the last `runtime.clock.spinWindowMs` | `hybrid` | Tick jitter p50, p99, max; CPU percent | T-ARC-06 |
| DS-09 | Colour blend space | `oklab`, `linear-rgb`, `srgb-legacy` (comparison only) | `oklab-hue-linear-intensity`: OKLab for hue and palette mixing, linear light for intensity | combined | Visual A/B in Inspector audition | T-MIX-02, T-REND-03 |
| DS-10 | Stems | `allinone-stems` (source separation), `band-proxies` | `fusion`: real stems when available, proxies otherwise, always labelled | `fusion` | Per-track readiness, analysis time | T-ANA-06 |
| DS-11 | Structure source weighting | `pssi-first`, `ml-first` | `fused` (spec 19) | `fused` | Section agreement statistics on validation set | T-ANA-11 |
| DS-12 | Metrical cross-check | `beat-this`, `allinone-beats` | `both` with agreement vote | `both` | Grid warning rate | T-ANA-07 |
| DS-13 | FLX4 MIDI backend | `native` (@julusian/midi in main), `webmidi` (renderer), `windows-midi-services` (multi-client on Windows) | `auto`: native, then Windows MIDI Services, then WebMIDI with a warning | `auto` | Open success, event latency | T-FLX-01 |
| DS-14 | Live audio capture host | `renderer` (Live window WebAudio), `audio-window` (hidden dedicated window) | `audio-window-with-renderer-fallback` | `audio-window` | Survives UI reload, CPU | T-AUD-01 |
| DS-15 | Rekordbox library reader | `rekordbox-connect` (TypeScript), `pyrekordbox` (uv sidecar) | `auto`: rekordbox-connect with pyrekordbox cross-check in diagnostics | `auto` | Row count agreement, read time | T-RBL-01 |
| DS-16 | Discovery rungs | each rung is its own boolean (section 3.6) | all enabled | all on | Which rung found each device | T-GOV-05 |
| DS-17 | Latency compensation | `measured` (qualified per unit), `sku-default` | `measured-else-sku` with a visible "unmeasured" badge | combined | Visible spread (camera) | T-REND-04 |
| DS-18 | Transition blackout translation | `full`, `deck-spatial-dip`, `deck-side-blackout`, `global-partial-dip` | `auto`: keep full only when both tracks structurally support it, else choose by other deck weight | `auto` | Count of translations per set | T-MIX-04 |
| DS-19 | Planner mode | `rules` (deterministic rules), `scored` (rule candidates chosen by evaluators) | `rules-with-veto`: rules output, evaluators may veto pathological sections and pick the next candidate | `rules-with-veto` (the owner may choose another mode after the validation set review) | Diagnostics per mode on validation set | T-PLAN-12 |
| DS-20 | Segment resolution per device | `logical`, `grouped`, `native` | `auto` (spec 53) | `auto` | Stable fps per resolution | T-GOV-15 |
| DS-21 | Single-zone rendering | see `render.singleZone.representative` | `area-weighted-mean-oklab` | combined | Owner visual review | T-FOV-03 |
| DS-22 | Rekordbox track identity on load | memory reader ID, Lighting IPC ID, agent API lookup, history table, title and path match | `resolver-chain` in that order with confidence | chain | Resolver tab shows which link resolved | T-RBL-07 |
| DS-23 | Adaptive fallback clock | `dj-bpm` (last known BPM and phase), `audio-onset` (live audio tempo) | `blend` with confidence weighting | `blend` | Beat error when source is lost | T-RUN-06 |
| DS-24 | Room distance metric for pulses | `euclidean`, `perimeter-geodesic`, `angular` | `auto`: geodesic for cells on a perimeter path, euclidean otherwise | `auto` | Visual review | T-ROOM-05 |
| DS-25 | Perimeter zero point | `dj-nearest`, `front-center`, `controller`, `custom-anchor` | none (a pure choice) | `dj-nearest` | n/a | T-ROOM-05 |
| DS-26 | Crossfader curve source | `software` (read from DJ software when exposed), `controller` (FLX4 hardware value), `configured` | `auto` in that order | `auto` | Agreement between sources | T-MIX-01 |
| DS-27 | White hit rendering on RGBWW fixtures | `rgb-white` (spec 48), `white-channel` (only if qualified not to disarm) | `rgb-white` unless qualification proves otherwise per unit | `rgb-white` | Stream survival test | T-GOV-09 |
| DS-28 | Adaptive director engine | `rules` (phrase look library), `audio-informed` (energy and onset driven) | `combined` | `combined` | Look change rate vs phrase boundaries | T-RUN-09 |
| DS-29 | ProLink participation | `passive` (listen only), `virtual-cdj` (announce as a player) | `auto`: passive, promote to virtual CDJ only when no real player uses the configured device number | `passive` | Packets seen, collisions | T-LIVE-05 |
| DS-31 | Per-device transport mode | `lan-segmented`, `lan-basic`, `ble-segmented`, `ble-basic`, `matter-basic`, `cloud-basic` (never frames, never during Live beat-critical use), `auto` | `hybrid`: segment frames only on verified segmented transports, whole-fixture fallback with banner | `hybrid` | Effective transport, frames sent per transport, switch count, time on degraded transport | T-FOV-01, T-FOV-02 |
| DS-32 | Perimeter orbit path choice between two points | `shortest` (fewest cells along the loop), `directed` (always `room.perimeter.direction`) | `auto`: directed for continuous orbits, shortest for point-to-point travel | `auto` | Visual review | T-ROOM-05, T-ROOM-07 |
| DS-33 | Spatial split side assignment | `signed-distance` (side of a drawn split line, continuous), `group-membership` (explicit group lists) | `blend`: signed distance with a feathered band, overridden by explicit membership where set | `blend` | Visual review | T-ROOM-06 |
| DS-34 | Track fingerprint | `pcm-hash` (exact hash of the canonical decode), `acoustic` (Chromaprint-style similarity) | `both`: exact first, acoustic proposes links the owner confirms | `both` | Match counts, false-link reports | T-ID-01 |
| DS-35 | Library watcher engine | `native-events` (@parcel/watcher), `polling` (stat sweep) | `auto`: native events plus a slow polling safety sweep that counts missed changes | `auto` | Missed-change counter, CPU | T-RBL-06, T-SER-04 |
| DS-36 | Ableton Link integration | `sidecar` (user-installed bridge process over a local socket), `sdk` (linked SDK, only with Ableton's proprietary license) | `auto`: sidecar when present, SDK when licensed, else unavailable with the reason | `auto` | Tempo and phase agreement with other sources | T-LIVE-12 |
| DS-30 | Packaging tool | build-time only: `electron-builder` is chosen and recorded in ADR-006; this is not a runtime switch because an app cannot switch its own installer | n/a | electron-builder | n/a | T-OPS-05 |

DS-30 is the one place this plan does not implement two options, because it
has no runtime meaning. The ADR must say so and the owner may override.
