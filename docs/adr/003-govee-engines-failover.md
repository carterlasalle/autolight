# ADR-003: Govee engines and failover

Date: 2026-10-01. Status: decided, pending owner review.

## Context

DS-02 (LAN stream engine), DS-03 (transport failover), DS-31 (per-device
transport mode). The toolkit stance is explicit per-device modes with no
silent failover; the homeassistant stance is fastest-verified for everything.

## Decision

LAN engine `auto`: govee-toolkit primary, native TypeScript razer codec on
our sockets when the addon fails to load or per device when the toolkit
reports errors. Byte parity tested between engines.

Failover `hybrid` (default): segment frames only on verified segmented
transports; whole-fixture fallback allowed with a visible banner; cloud never
carries frames (runtime invariant, T-TRU-12). `strict` and `auto` remain
selectable. Every switch is an event: logged, recorded, shown on the tile,
counted in metrics, reversible by explicit mode choice. Congestion reduces
only the affected device's physical rate; the logical show stays 60 Hz.

## Measurements

Frames sent, superseded frames, send time, errors per engine; time to
failover, frames lost, transport per fixture (T-GOV-01 to T-GOV-03, T-FOV-01).

## Owner decision status

Pending: owner confirms hybrid default stands after the simulator
failover measurements (T-QA-04 evidence).
