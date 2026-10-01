# ADR-009: Beat origin and units

Date: 2026-10-01. Status: decided, pending owner review.

## Context

Beats are the show clock: planner stages, restraint budgets, fusion dispute
thresholds, and seek detection all read beats. Mixed units (seconds vs
beats vs milliseconds) caused the axBeatToPlayhead whole-beat error and the
prolink millisecond-as-beat error (F-LIVE-04, F-LIVE-05).

## Decision

Beats are fractional doubles everywhere; seconds and milliseconds convert at
trust boundaries through beat mapping in both directions (mutation-covered
critical list, T-TRU-08). `live.fusion.disagreeBeats` (0.25) and
`runtime.seek.thresholdBeats` (0.5) are beats; `live.provider.staleMs` and
`live.fusion.switchHoldMs` are milliseconds. Beat-to-time mapping is tested
both ways, including seek reconstruction equivalence.

## Measurements

Track-sync matrix beat error p95 under `qa.sync.maxBeatErrorMs` per provider
row (T-QA-07).

## Owner decision status

Pending: none. Owner action only if the matrix shows a unit the catalog
mislabels.
