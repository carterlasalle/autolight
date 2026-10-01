# ADR-005: Storage driver

Date: 2026-10-01. Status: decided, pending owner review.

## Context

DS-06: better-sqlite3 (spec 80) vs node:sqlite (built-in). The app database
opens in userData at startup stage 2, WAL mode verified by reading the
pragma back.

## Decision

Combined `auto`: better-sqlite3 primary, falling back to node:sqlite when
the native module cannot load, with a visible status. Kysely on top in both
cases. Driver parity: the whole storage suite runs on both drivers.

## Measurements

Open time, write latency p99 per driver (T-DATA-01 evidence).

## Owner decision status

Pending: none. Owner action only if both drivers fail on a target OS.
