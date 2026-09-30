# Config reference

Generated from `docs/finish/03-config-and-decisions.md` section 3 by `yarn workspace @autolight/config run export`. Do not hand-edit.

240 keys. Receipt kinds: spec (SPEC mandates), upstream (measured upstream), measured (measured by us), unmeasured (starting guess with owning task).

| Key | Default | Unit | Range | Receipt | Live-safe |
| --- | --- | --- | --- | --- | --- |
| `runtime.host` | `worker-thread` | enum DS-07 | see DS-07 | spec 56 | N |
| `runtime.clock.tickHz` | `60` | Hz | 30 to 120 | spec 117 | N |
| `runtime.clock.timerStrategy` | `hybrid` | enum DS-08 | see DS-08 | unmeasured (T-ARC-06) | N |
| `runtime.clock.spinWindowMs` | `1.5` | ms | 0 to 5 | unmeasured (T-ARC-06) | N |
| `runtime.snapshot.uiRateHz` | `30` | Hz | 10 to 60 | unmeasured (T-ARC-04) | Y |
| `runtime.snapshot.maxBytes` | `262144` | bytes | 16384 to 4194304 | unmeasured (T-ARC-04) | Y |
| `runtime.crash.holdMs` | `2000` | ms | 0 to 30000 | unmeasured (T-ARC-03) | Y |
| `runtime.estimator.correctionGain` | `0.15` | ratio per tick | 0.01 to 1 | unmeasured (T-RUN-02) | Y |
| `runtime.estimator.maxSlewBeatsPerSec` | `0.08` | beats/s | 0 to 1 | unmeasured (T-RUN-02) | Y |
| `runtime.estimator.maxErrorMs` | `20` | ms | 1 to 200 | unmeasured target | Y |
| `runtime.seek.thresholdBeats` | `0.5` | beats | 0.1 to 16 | unmeasured (was 8, `show-runtime/src/index.ts:42`) | Y |
| `runtime.seek.thresholdMs` | `150` | ms | 10 to 2000 | unmeasured (was 250, `dj-core/src/index.ts:12`) | Y |
| `runtime.scratch.rateDeviation` | `0.5` | ratio | 0.05 to 2 | unmeasured (T-RUN-05) | Y |
| `runtime.scratch.minReversalsPerSec` | `2` | 1/s | 0 to 20 | unmeasured | Y |
| `runtime.scratch.resyncAt` | `bar` | enum beat, bar, phrase |  | spec 61 "next sensible boundary" | Y |
| `runtime.loop.variation` | `alternate-ab` | enum none, alternate-ab, rotate-3 |  | spec 59 | Y |
| `runtime.roll.degradeOrder` | `["pulse","contraction","impact"]` | list |  | spec 60 | Y |
| `runtime.health.extrapolateMs` | `500` | ms |  | spec 105 | Y |
| `runtime.health.holdMs` | `2000` | ms |  | spec 105 | Y |
| `runtime.override.resumeDefault` | `bar` | enum | beat, bar, phrase, immediate | spec 134 | Y |
| `runtime.override.whiteIntensity` | `1.0` | ratio | 0 to 1 | spec 48 | Y |
| `runtime.override.masterIntensity` | `1.0` | ratio | 0 to 1 | spec 94 | Y |
| `runtime.fastPath.budgetMs` | `100` | ms |  | unmeasured target (spec 138 "instantly") | N |
| `runtime.upgrade.boundary` | `phrase` | enum section, phrase, bar |  | spec 140 | Y |
| `ops.startup.budgetMs` | `10000` | ms | 1000 to 60000 | unmeasured target (spec 132) | N |
| `runtime.adaptive.phraseBeats` | `32` | beats | 8 to 64 | unmeasured | Y |
| `runtime.adaptive.cooldownPhrases` | `2` | phrases | 0 to 8 | was 2 (`reactive-audio/src/index.ts:35`) | Y |
| `runtime.adaptive.engine` | `combined` | enum DS-28 |  | owner | Y |
| `runtime.adaptive.minLooks` | `24` | count | 1 to 500 | unmeasured | Y |
| `mixer.crossfader.curve` | `source` | enum source, linear, constant-power, sharp-cut |  | spec 63 | Y |
| `mixer.crossfader.assignment` | `{ "1": "A", "2": "B", "3": "THRU", "4": "THRU" }` | map | A, B, THRU | spec 63 | Y |
| `mixer.weight.masterBonus` | `0.1` | ratio | 0 to 0.5 | unmeasured | Y |
| `mixer.intro.paletteAt` | `0.05` | weight | 0 to 1 | was hardcoded (`show-mixer/src/index.ts:31`) | Y |
| `mixer.intro.rhythmAt` | `0.3` | weight | 0 to 1 | was hardcoded | Y |
| `mixer.intro.impactsAt` | `0.7` | weight | 0 to 1 | was hardcoded | Y |
| `mixer.blackout.policy` | `auto` | enum DS-18 |  | spec 66 | Y |
| `mixer.blackout.otherDeckThreshold` | `0.3` | weight | 0 to 1 | was hardcoded (`show-mixer/src/index.ts:25`) | Y |
| `mixer.owner.hysteresis` | `0.1` | ratio | 0 to 0.5 | unmeasured | Y |
| `mixer.owner.factorWeights` | `{ weight: 1, master: 0.3, confidence: 0.5, strength: 1, significance: 0.5 }` | map |  | unmeasured (spec 65 factors) | Y |
| `mixer.blendSpace` | `oklab-hue-linear-intensity` | enum DS-09 |  | spec 64 (combined mode) | Y |
| `render.gammaDefault` | `2.2` | exponent | 1 to 3 | spec 49 approximation; per device from calibration | Y |
| `render.antialias.subCell` | `true` | bool |  | owner room request | Y |
| `render.singleZone.representative` | `area-weighted-mean-oklab` | enum mean-linear, area-weighted-mean-oklab, dominant, center-cell |  | unmeasured | Y |
| `render.latency.mode` | `measured-else-sku` | enum DS-17 |  | spec 55 | Y |
| `render.impact.defaultMs` | `90` | ms | 20 to 500 | spec 36 example | Y |
| `render.strobe.maxHz` | `12` | Hz | 1 to 30 | unmeasured; also capped by fixture fps | Y |
| `render.tickBudgetMs` | `4` | ms per tick (2,000 cells, two decks) | 1 to 16 | unmeasured target | N |
| `planner.version` | `read-only` | string |  | code | N |
| `planner.mode` | `rules-with-veto` | enum DS-19 |  | spec 113 (combined mode) | N |
| `planner.sectionEnergy` | `{intro:.3, verse:.45, prechorus:.6, build:.8, drop:1, chorus:.9, breakdown:.25, bridge:.5, instrumental:.6, solo:.7, outro:.3, transition:.5, unknown:.5}` | map |  | was `SECTION_ENERGY` (`show-planner/src/index.ts:65-69`) | Y |
| `planner.drop.minConfidence` | `0.5` | ratio |  | unmeasured | Y |
| `planner.drop.stages` | `[8,8,8,4,4]` | beats list |  | spec 36 example | Y |
| `planner.drop.preDarknessBeats` | `1` | beats |  | spec 35, 36 | Y |
| `planner.drop.burstBeats` | `2` | beats |  | spec 36 | Y |
| `planner.restraint.whiteHitMinBeats` | `16` | beats |  | was 8, now a registry key | Y |
| `planner.restraint.blackoutMinBeats` | `32` | beats |  | unmeasured | Y |
| `planner.restraint.strobeMaxDuty` | `0.08` | ratio |  | unmeasured | Y |
| `planner.restraint.paletteChangeMinBeats` | `16` | beats |  | spec 114 | Y |
| `planner.restraint.patternRepeatMax` | `4` | count |  | unmeasured | Y |
| `planner.restraint.sectionImpactMax` | `3` | count |  | unmeasured | Y |
| `planner.restraint.trackImpactMax` | `12` | count |  | unmeasured | Y |
| `planner.contrast.breakdownMaxMean` | `0.3` | ratio |  | unmeasured | Y |
| `planner.recurrence.similarityThreshold` | `0.8` | cosine |  | unmeasured | Y |
| `planner.candidates.perSection` | `4` | count |  | DS-19 | Y |
| `planner.chase.basePeriodBeats` | `8` | beats |  | was hardcoded | Y |
| `planner.palette.minDistance` | `0.12` | OKLab distance |  | unmeasured | Y |
| `planner.events.minConfidence` | `per event type map, 0.5 default` | ratio |  | unmeasured | Y |
| `planner.evaluation.bounds` | `map of the ten spec 115 diagnostics to allowed ranges` | map |  | unmeasured | Y |
| `planner.compile.budgetMs` | `2000` | ms p95 |  | unmeasured target | N |
| `planner.validation.rejectOn` | `["exclusive-overlap","negative-duration","out-of-range","unsupported-capability"]` | list |  | spec 114 | N |
| `audio.capture.host` | `audio-window` | enum DS-14 |  | owner | N |
| `audio.capture.deviceId` | `"" (none)` | string |  | user | Y |
| `audio.fftSize` | `2048` | samples |  | unmeasured | N |
| `audio.melBands` | `24` | count |  | unmeasured | N |
| `audio.agc.rise` | `0.3` | ratio |  | was hardcoded (`reactive-audio/src/index.ts:11`) | Y |
| `audio.agc.decay` | `0.05` | ratio |  | was hardcoded | Y |
| `audio.agc.target` | `0.5` | ratio |  | was hardcoded | Y |
| `audio.onset.threshold` | `1.5` | z-score |  | unmeasured | Y |
| `audio.overlay.cap` | `0.2` | ratio |  | was `MAX_OVERLAY_GAIN`; final amount = cap times `style.reactiveAmount` | Y |
| `analysis.worker.concurrency` | `1` | jobs |  | unmeasured | N |
| `analysis.worker.restartBackoffMs` | `[1000, 30000]` | ms min/max |  | unmeasured | N |
| `analysis.worker.jobTimeoutMs` | `900000` | ms |  | unmeasured | N |
| `analysis.worker.heartbeatMs` | `5000` | ms |  | unmeasured | N |
| `analysis.cacheDir` | `<userData>/analysis-cache` | path |  | spec 82 | N |
| `analysis.device` | `auto` | enum auto, cpu, cuda |  | spec 16 | N |
| `analysis.ml.enabled` | `true` | bool |  | spec 16 | N |
| `analysis.ml.modelCacheDir` | `<userData>/models` | path |  | T-ANA-05 | N |
| `analysis.ml.offlineOnly` | `true during Live` | bool |  | spec 110 | N |
| `analysis.stems.mode` | `fusion` | enum DS-10 |  | owner | N |
| `analysis.structure.mode` | `fused` | enum DS-11 |  | spec 19 | N |
| `analysis.metrical.mode` | `both` | enum DS-12 |  | spec 17 | N |
| `analysis.frame.hop` | `512` | samples |  | unmeasured (was 1024) | N |
| `analysis.frame.size` | `2048` | samples |  | was hardcoded | N |
| `analysis.bands` | `{bass:[20,150], lowMid:[150,500], mid:[500,2000], high:[2000,20000]}` | Hz |  | was hardcoded (`stems.py:51-59`) | N |
| `analysis.build.windows` | `[8,16,32]` | beats |  | spec 23 | N |
| `analysis.drop.minJump` | `0.25` | relative |  | was hardcoded (`structure.py:81`) | N |
| `analysis.drop.minVotes` | `3` | count |  | was hardcoded | N |
| `analysis.drop.minConfidence` | `0.6` | ratio |  | was hardcoded | N |
| `analysis.silence.level` | `0.05` | ratio of max |  | was hardcoded (`worker.py:47`) | N |
| `analysis.fakeDrop.gapBeats` | `[1,4]` | beats |  | spec 25 | N |
| `analysis.gridWarning.toleranceMs` | `50` | ms |  | was 0.05 s | N |
| `analysis.gridWarning.minAnchors` | `32` | count |  | unmeasured | N |
| `analysis.decode.resampler` | `soxr` | enum soxr, swr |  | unmeasured | N |
| `analysis.beatthis.invoke` | `api` | enum api, cli |  | upstream README | N |
| `analysis.aggregate.subdivisions` | `4` | per beat |  | unmeasured | N |
| `analysis.stems.keepAudio` | `false` | bool |  | disk budget | N |
| `govee.lan.engine` | `auto` | enum DS-02 |  | owner | N |
| `govee.lan.ports.scan` | `4001` | port |  | Govee WLAN guide | N |
| `govee.lan.ports.reply` | `4002` | port |  | Govee WLAN guide | N |
| `govee.lan.ports.control` | `4003` | port |  | Govee WLAN guide | N |
| `govee.lan.interfaces` | `[] (all eligible)` | list of interface names |  | spec 111 | N |
| `govee.lan.discovery.multicast` | `true` | bool |  | govee2mqtt `lan_api.rs` | N |
| `govee.lan.discovery.perInterfaceBroadcast` | `true` | bool |  | govee2mqtt | N |
| `govee.lan.discovery.globalBroadcast` | `true` | bool |  | govee2mqtt | N |
| `govee.lan.discovery.scanList` | `[]` | IPs or hostnames |  | govee2mqtt `GOVEE_LAN_SCAN` | N |
| `govee.lan.discovery.retryInitialMs` | `2000` | ms |  | govee2mqtt `lan_api.rs:521` | Y |
| `govee.lan.discovery.retryMaxMs` | `60000` | ms |  | govee2mqtt `lan_api.rs:522` | Y |
| `govee.lan.discovery.backgroundRescanMs` | `30000` | ms |  | unmeasured (Lightwave 15 s, HA 300 s) | Y |
| `govee.lan.status.retryMs` | `350` | ms |  | govee2mqtt `lan_api.rs:605` | Y |
| `govee.lan.status.deadlineMs` | `10000` | ms |  | govee2mqtt `lan_api.rs:601` | Y |
| `govee.lan.arm.settleMsDefault` | `50` | ms |  | toolkit measurements default | N |
| `govee.lan.stream.fallbackHz` | `10` | Hz |  | toolkit `FALLBACK_HZ` | N |
| `govee.lan.stream.targetHz` | `60` | Hz |  | spec 117 logical rate; per device capped by qualification | N |
| `govee.lan.stream.keepaliveMs` | `0 (off)` | ms |  | only if qualification shows the unit drops an idle stream | N |
| `govee.lan.stream.maxRearmAttempts` | `3` | count |  | unmeasured (spec 147 "do not spam") | Y |
| `govee.lan.stream.rearmWindowMs` | `60000` | ms |  | unmeasured | Y |
| `govee.lan.command.minSpacingMs` | `40` | ms |  | unmeasured (toolkit: third back-to-back command dropped) | N |
| `govee.lan.reconnect.maxMs` | `5000` | ms |  | unmeasured target | Y |
| `govee.lan.backoff.minFps` | `5` | fps |  | was hardcoded (`govee/src/index.ts:213`) | Y |
| `govee.brightness.maxPerMinute` | `6` | commands |  | unmeasured (spec 50 "slow") | Y |
| `govee.identify.flashMs` | `1000` | ms |  | comment intent in `show-service.ts:101` | Y |
| `govee.testChase.stepMs` | `150` | ms |  | unmeasured | Y |
| `govee.ble.backend` | `auto` | enum DS-04 |  | owner | N |
| `govee.ble.encryptedLink` | `auto` | enum DS-05 |  | owner decision | N |
| `govee.ble.writeBudgetHzDefault` | `100` | Hz |  | toolkit `devices/H61A0.yaml:273` (one unit) | N |
| `govee.ble.writeDrainMsDefault` | `300` | ms |  | unmeasured (toolkit says measure per unit) | N |
| `govee.ble.scanTimeoutMs` | `10000` | ms |  | unmeasured | Y |
| `govee.ble.colorQuantizeLevels` | `0 (off)` | levels per channel |  | unmeasured | Y |
| `govee.ble.hostColorChannel` | `true` | bool |  | toolkit ble.md section 8 | Y |
| `govee.matter.enabled` | `false` | bool |  | owner decision per device | N |
| `govee.matter.commandRateHz` | `10` | Hz |  | unmeasured | Y |
| `govee.cloud.enabled` | `false` | bool |  | spec 148 | N |
| `govee.cloud.perDevicePerMinute` | `10` | requests |  | Govee docs via toolkit `cloud.md:102` | N |
| `govee.cloud.perAccountPerDay` | `10000` | requests |  | Govee docs via toolkit `cloud.md:101` | N |
| `govee.failover.policy` | `hybrid` | enum DS-03 |  | owner | N |
| `govee.failover.lanLossMs` | `3000` | ms |  | unmeasured | Y |
| `govee.failover.probeIntervalMs` | `10000` | ms |  | unmeasured | Y |
| `govee.device.<fixtureId>.transportMode` | `hybrid` | enum DS-31 |  | owner (per device) | Y |
| `govee.device.<fixtureId>.transportOrder` | `["lan-razer","ble-segmented","lan-json","ble-single","matter"]` | ordered list |  | spec 148 | Y |
| `live.provider` | `fusion` | enum DS-01 |  | owner | N |
| `live.provider.staleMs` | `500` | ms |  | spec 105 | Y |
| `live.rkbx.oscBind` | `127.0.0.1:4460` | host:port |  | rkbx_link README default destination | N |
| `live.rkbx.configPath` | `""` | path to user's rkbx_link folder |  | user | N |
| `live.prolink.mode` | `passive` | enum DS-29 |  | owner | N |
| `live.prolink.deviceNumber` | `7` | 1 to 15 |  | unmeasured (must not collide with real players) | N |
| `live.prolink.keepaliveMs` | `1500` | ms |  | dysentery analysis | N |
| `live.prolink.peerExpiryMs` | `5000` | ms |  | unmeasured | Y |
| `live.ax.intervalMs` | `250` | ms |  | unmeasured (was 1000) | Y |
| `live.ax.timeoutMs` | `2000` | ms |  | unmeasured (was 8000) | Y |
| `live.agentApi.port` | `30001` | port |  | rkbx_os2l README, capture log | N |
| `live.os2l.enabled` | `true` | bool |  | owner notes | N |
| `live.link.enabled` | `true` | bool |  | spec 10 | N |
| `live.link.quantum` | `4` | beats |  | Ableton Link default | Y |
| `live.memoryReader.enabled` | `false` | bool |  | owner consent required | N |
| `live.memoryReader.offsetsFile` | `<userData>/offsets/rekordbox.json` | path |  | T-LIVE-11 | N |
| `live.lighting.enabled` | `true` | bool |  | spec 7 | N |
| `live.fusion.authority` | `["lighting-ipc","memory-cleanroom","rkbx-osc","prolink","composite-flx4","ax","os2l"]` | ordered list |  | spec 7 extended by owner | Y |
| `live.fusion.disagreeBeats` | `0.25` | beats |  | unmeasured | Y |
| `live.fusion.switchHoldMs` | `500` | ms |  | unmeasured | Y |
| `live.rkbx.playingEpsilonMs` | `5` | ms |  | unmeasured | Y |
| `live.rkbx.pauseHoldMs` | `150` | ms |  | unmeasured | Y |
| `live.prolink.interfaces` | `[] (all eligible)` | list |  | spec 111 | N |
| `live.ax.cpuBudgetPercent` | `3` | percent |  | unmeasured | Y |
| `live.composite.openFilePollMs` | `500` | ms |  | unmeasured | Y |
| `live.composite.correlationWindowMs` | `4000` | ms |  | unmeasured | Y |
| `live.composite.lockedErrorMs` | `15` | ms |  | unmeasured target | Y |
| `live.link.mode` | `auto` | enum DS-36 |  | license constraint | N |
| `live.link.publish` | `false` | bool |  | owner | Y |
| `flx4.backend` | `auto` | enum DS-13 |  | owner | N |
| `flx4.portMatch` | `DDJ-FLX4` | regex |  | device name | N |
| `flx4.tempoRange` | `source` | enum source, 6, 10, 16, wide |  | Rekordbox tempo range setting | Y |
| `flx4.hotplugPollMs` | `2000` | ms |  | unmeasured | Y |
| `flx4.hints.filterWindowMs` | `1500` | ms |  | unmeasured | Y |
| `flx4.hints.enabled` | `all hint types` | list |  | spec 11 | Y |
| `serato.remote.enabled` | `true` | bool |  | spec 3.1 | N |
| `serato.master.inferHoldMs` | `750` | ms |  | unmeasured | Y |
| `library.rekordbox.reader` | `auto` | enum DS-15 |  | owner | N |
| `library.watch.debounceMs` | `2000` | ms |  | unmeasured | Y |
| `library.watch.engine` | `auto` | enum DS-35 |  | owner | N |
| `library.watch.pollMs` | `60000` | ms |  | unmeasured | Y |
| `library.fileHash.strategy` | `full` | enum full, sampled |  | spec 12 | N |
| `library.rekordbox.dbPath` | `auto-detected` | path |  | rekordbox-connect detection | N |
| `library.rekordbox.optionsPath` | `auto-detected` | path |  | rekordbox-connect detection | N |
| `library.rekordbox.sharePath` | `auto-detected` | path |  | rekordbox-connect detection | N |
| `library.rekordbox.crossCheck` | `true` | bool |  | DS-15 combined mode | N |
| `library.serato.root` | `auto-detected (~/Music/_Serato_)` | path |  | serato-connect, Serato docs | N |
| `identity.fingerprint.mode` | `both` | enum DS-34 |  | spec 12 | N |
| `identity.fingerprint.acousticThreshold` | `0.9` | similarity |  | unmeasured | N |
| `contracts.mapping.benchMs` | `250` | ms per million mappings |  | unmeasured target | N |
| `room.distanceMetric` | `auto` | enum DS-24 |  | owner room request | Y |
| `room.perimeter.zero` | `dj-nearest` | enum DS-25 |  | owner room request | Y |
| `room.perimeter.direction` | `clockwise` | enum clockwise, counterclockwise |  | owner | Y |
| `room.pivot` | `room-center` | enum room-center, dj, anchor id |  | owner | Y |
| `room.sides.centerBandWidth` | `0.15` | fraction of room width |  | unmeasured | Y |
| `room.splits.defaultAngleDeg` | `0` | degrees from DJ facing |  | owner | Y |
| `room.splits.mode` | `blend` | enum DS-33 |  | owner room request | Y |
| `room.splits.featherMeters` | `0.25` | m |  | unmeasured | Y |
| `room.zones.featherMeters` | `0.2` | m |  | unmeasured | Y |
| `room.orbit.path` | `auto` | enum DS-32 |  | owner room request | Y |
| `room.orientation.leftRightFrom` | `dj` | enum dj, audience |  | spec 40 | Y |
| `room.nearDj.radiusMeters` | `1.5` | m |  | unmeasured | Y |
| `venue.spline.toleranceMeters` | `0.005` | m |  | unmeasured | N |
| `venue.fields.budgetMs` | `20` | ms for 2,000 cells |  | unmeasured target | N |
| `storage.driver` | `auto` | enum DS-06 |  | owner | N |
| `storage.sqlite.synchronous` | `NORMAL` | enum OFF, NORMAL, FULL |  | SQLite WAL guidance | N |
| `storage.sqlite.busyTimeoutMs` | `5000` | ms |  | unmeasured | N |
| `ops.safeState.look` | `ending-look` | enum hold-last, ending-look, blackout |  | spec 133 | Y |
| `diagnostics.mode` | `normal` | enum normal, diagnostic |  | spec 102, 130 | Y |
| `diagnostics.log.maxFileMb` | `10` | MB |  | unmeasured | N |
| `diagnostics.log.files` | `5` | count |  | unmeasured | N |
| `diagnostics.recorder.enabled` | `false` | bool |  | spec 103 | Y |
| `diagnostics.recorder.maxMb` | `512` | MB |  | unmeasured | N |
| `security.cloudAllowed` | `false` | bool |  | spec 110 | N |
| `update.checkOnLaunch` | `false` | bool |  | spec 145 | N |
| `update.neverDuringLive` | `read-only invariant` |  |  | spec 145 | N |
| `ui.shortcuts.*` | `B blackout, W white, F freeze, A auto, M manual, Up and Down master, 1 to 9 presets` | map |  | spec 94 | Y |
| `ui.shortcuts.whiteMode` | `hold` | enum hold, toggle |  | owner | Y |
| `ui.live.minTimingFontPx` | `48` | px |  | spec 143 | Y |
| `ui.live.minBodyFontPx` | `16` | px |  | spec 143 | Y |
| `qa.events.toleranceBeats` | `1` | beats |  | unmeasured target | N |
| `qa.events.minRecall` | `per event type map, 0.8 default` | ratio |  | unmeasured target | N |
| `qa.events.minPrecision` | `per event type map, 0.7 default` | ratio |  | unmeasured target | N |
| `qa.key.minAccuracy` | `0.7` | ratio |  | unmeasured target | N |
| `qa.replay.timeToleranceMs` | `5` | ms |  | unmeasured target | N |
| `qa.faults.*` | `scenario parameter maps` | map |  | spec 104 to 107 | N |
| `qa.perf.ciSlack` | `3` | multiplier on reference thresholds |  | CI runner variance | N |
| `qa.soak.maxMemSlopeMbPerHour` | `5` | MB per hour |  | spec 125 "no growth trend" | N |
| `qa.soak.maxLatencySlopeMsPerHour` | `1` | ms per hour |  | spec 125 | N |
| `qa.sync.maxBeatErrorMs` | `20` | ms p95 |  | unmeasured target | N |
| `qa.validation.minPerCategory` | `3` | tracks |  | spec 116 | N |
