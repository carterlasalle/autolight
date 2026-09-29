# Architecture

See SPEC.MD §155 for the full boundary.

```text
Rekordbox/Serato → DeckState + TrackModel → ShowPlanner → ShowPlan
→ ShowRuntime + ShowMixer → Renderer → VenueModel → Govee LAN streams
```

- Timing truth: DJ beatgrid (§2.2), beats not seconds (§73).
- Analysis describes music; planner directs the show (§2.3).
- Blackout = RGB 0,0,0, never power-off (§47).
- Transport: newest-state-wins, no stale queues (§49, §51, §149).
