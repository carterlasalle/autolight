# ADR-010: Config registry

Date: 2026-10-01. Status: decided, pending owner review.

## Context

240 keys across 11 groups. Hardcoded tunables were the most common scar
(S21): thresholds, ports, intervals, budgets, gamma. Secrets must never
share the config file (T-SEC-01).

## Decision

One registry in packages/config: every tunable declared once with type,
default, unit, range, receipt, live-safety, and scope; generated markdown
reference and Python schema checked stale in CI. Layers resolve default <
app < venue < device < style < session; the UI shows the supplying layer.
Secrets (`govee.cloud.apiKey`, `agent.apiToken`) are rejected by set and
import and live in the SecretVault behind safeStorage instead. Invariants
(blackout never powers off, cloud never carries frames, no modal during
Live) are code, listed read-only under Guarantees.

## Measurements

Registry size printed in CI; zero keys without receipt; no-magic-number
rule at blocking with zero findings (T-CFG-01, T-CFG-04).

## Owner decision status

Pending: owner reviews unmeasured receipts as each owning task measures
them; threshold changes need an evidence entry with owner approval.
