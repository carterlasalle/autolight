# ADR-008: BLE backend and encrypted link

Date: 2026-10-01. Status: decided, pending owner review.

## Context

DS-04 (toolkit-ble vs noble) and DS-05 (encrypted link off vs on). Some
units require the encrypted handshake; the advertisement sets bit 0x40 and
the version characteristic reports v2 on those units.

## Decision

Backend `auto`: toolkit btleplug when available, noble otherwise or per
device. Encrypted link `auto`: handshake only when the advertisement sets
bit 0x40 or the version characteristic reports v2. The owner confirms
shipping keys before the handshake is enabled for all devices. Wi-Fi
provisioning passwords stay in memory for the transfer unless the owner
opts into safeStorage (T-BLE-10); provisioning is plaintext over the air.

## Measurements

Connect time, write success, pacing adherence per backend; handshake success
per device (T-BLE-01, T-BLE-07 evidence).

## Owner decision status

Pending: owner confirms shipping keys; owner runs HW-BLE-01 on at least one
unit or records unavailability with evidence.
