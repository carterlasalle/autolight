# ADR-004: Show host placement and clock

Date: 2026-10-01. Status: decided, pending owner review.

## Context

DS-07 (worker-thread vs utility-process) and DS-08 (interval vs timeout-spin
vs hybrid). The show must survive a renderer reload with zero frame gap
(spec 108) and hold 60 Hz logical with p99 jitter under 5 ms (spec 117).

## Decision

Default `worker-thread` (spec 56); `utility-process-worker` available behind
the switch: a utilityProcess whose render loop runs on its own worker thread.
Clock default `hybrid`: Atomics.wait coarse sleep plus a spin tail for the
last `runtime.clock.spinWindowMs`, measured per strategy per host mode by
T-ARC-06. The winning strategy becomes the default with its receipt updated.

## Measurements

Tick jitter p50, p99, max and CPU percent under idle, renderer-freeze, and
DB-burst loads, per strategy per host mode (T-ARC-06 evidence).

## Owner decision status

Pending: owner reviews the T-ARC-06 jitter table before the default is
locked for M5.
