// Vitest workspace (T-TRU-07): every package runs src tests only; dist never
// collected (S18). Coverage thresholds live here; lowering one needs an entry
// in docs/finish/evidence/T-TRU-07/threshold-changes.md with owner approval.
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/*/vitest.config.ts",
  "apps/desktop/vitest.config.ts",
]);
