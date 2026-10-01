# ADR-007: Room model and spatial fields

Date: 2026-10-01. Status: decided, pending owner review.

## Context

DS-24 (distance metric), DS-25 (perimeter zero, pure choice), DS-32 (orbit
path), DS-33 (split side assignment), plus room defaults the owner requested
(pivot, splits mode, orbit path, orientation). The owner's rig has segmented
strips tracing the ceiling perimeter of a square room.

## Decision

Combined modes: distance `auto` (geodesic on perimeter paths, euclidean
otherwise); zero `dj-nearest` (pure choice, no combine); orbit `auto`
(directed for continuous orbits, shortest for point travel); splits `blend`
(signed distance with feathered band, overridden by explicit membership).
Per-owner-request defaults recorded in the catalog (pivot room-center,
splits blend, feather meters, near-DJ radius) and tuned against the owner's
visual review, not a metric table.

## Measurements

Visual review per switch (owner room renders, T-ROOM-05 to T-ROOM-07).

## Owner decision status

Pending: owner confirms the room defaults on the real rig during M4.
