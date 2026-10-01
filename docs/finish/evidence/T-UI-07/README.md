# T-UI-07: Track corrections

Closes F-UI-09. Spec 97 (wp13-ui.md T-UI-07).

## What changed

- `apps/desktop/src/routes/inspector/inspector-helpers.ts` `CorrectionOp`
  union: rename-section, move-event, delete-drop, add-drop, mark-fake-drop
  (beat plus actual impact beat), change-style, regenerate-section,
  lock-section; `undoStack`/`redoPop` history helpers.
- `features/inspector/inspector-view.tsx`: five correction buttons (add
  missing drop at 256, delete false drop at 256, mark fake 256 to 288,
  regenerate 224..256, lock 224..256) sending `{ version: 1, op }` over typed
  IPC with an on-screen queued line. Move/rename/style ops are in the type
  and available to the next pass; the five buttons cover the DoD shapes.
- Undo/redo: helpers tested; screen wiring lands with the planner's
  corrections stack (T-PLAN-11 owns persistence, locks, planner bumps).

## Proof

- `inspector-helpers.test.ts` undo row: push one op, pop returns it and
  empties; empty pop returns null head.
- Restart plus planner-bump survival is T-PLAN-11's store test; this task
  proves the op shapes plus history math. Owned run: 15 files, 83 passed.

## Delete test

- Drop `actualBeat` from mark-fake-drop and the type row goes red at
  typecheck wherever the button passes it; break `redoPop` slicing and the
  history row goes red.

## Seams

- Persistence, who/when stamps, and regeneration math are T-PLAN-11.
  `show/correction` channel is sent via the existing string invoke; the
  router/handler is NOT this slice (no electron edits).
