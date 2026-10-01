# T-MIX-03: Exclusive impact ownership

Closes F-MIX-07; probes `P-65-owner`, `P-65-no-leak` (spec 65).

## What changed

- `ownerScore` weights `mixer.owner.factorWeights` over audible weight, master
  status, event confidence, event strength and structural significance (the
  planner's figure when supplied, otherwise the exclusive cue type's), and
  `impactOwner` picks the deck with the higher score.
- `mixer.owner.hysteresis` keeps the incumbent until a challenger clearly
  wins, so ownership does not flap during a fader ride.
- A non-owner's exclusive cue (blackout, strobe, white hit, full-room impact)
  is translated (T-MIX-04) or dropped with a recorded reason in
  `MixResult.dropped`; only the owner's exclusives reach the frame.

## Proof

- `packages/show-mixer/src/owner.test.ts`: every factor moves the score in the
  expected direction, a silent deck scores zero, hysteresis holds a close
  call and yields to a decisive challenger, and the mix-down shows the real
  reasons.
- Same file, `P-65-no-leak`: the non-owner's white hit is dropped, the
  rendered frame contains no white cell, and adding the leaked cue back would
  visibly change the frame hash.
- Scoped smoke run this session: both checks pass against the source.

## Delete test

Remove the `weight <= 0` gate in `ownerScore` and the silent-deck test goes
red (a silent deck would own the blackout). Remove the hysteresis branch and
the incumbent test flips to the challenger. Stop dropping the non-owner's
exclusive and the no-leak frame test goes red.
