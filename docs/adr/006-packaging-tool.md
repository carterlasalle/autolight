# ADR-006: Packaging tool

Date: 2026-10-01. Status: decided, pending owner review.

## Context

DS-30 is build-time only: an app cannot switch its own installer, so it has
no runtime mode and the decision catalog records a single option.

## Decision

electron-builder for macOS (arm64 and x64 or universal, dmg and zip) and
Windows (NSIS, x64 and arm64 where native modules build). Native addons
rebuilt for Electron and listed in asarUnpack; bundled uv, pinned Python,
locked analysis environment or offline wheel cache; FFmpeg with license
recorded; model weights only where licenses allow, else downloaded in Setup
with consent. Unsigned artifacts build in CI; the signed pipeline runs when
Apple Developer ID and Windows certificate credentials exist (owner spend
decision). Hardened runtime entitlements recorded in T-OPS-05.

## Measurements

Packaged builds for both OSes in CI; smoke-install job launches them and
runs the headless checks (T-OPS-05, T-TRU-11).

## Owner decision status

Pending: owner approves signing certificate spend. DS-30 documents the
single-option exception the owner may override.
