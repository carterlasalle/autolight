/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "renderer-no-show-internals",
      comment: "S7: renderer observes snapshots and sends intents; it owns no timing or output (T-TRU-04).",
      severity: "error",
      from: { path: "apps/desktop/src" },
      to: { path: "(show-runtime|show-mixer|packages/renderer|packages/govee)", pathNot: "\\.test\\.ts$" },
    },
    {
      name: "renderer-no-simulator",
      comment: "S3: production never imports the simulator except the Simulator mode entry (T-TRU-02).",
      severity: "error",
      from: { path: "apps/desktop/(src|electron)", pathNot: "(services/simulator-mode|\\.test)" },
      to: { path: "packages/simulator", pathNot: "\\.test\\.ts$" },
    },
    {
      name: "planner-no-device-internals",
      comment: "Plans are venue independent (T-PLAN-01).",
      severity: "error",
      from: { path: "packages/show-planner" },
      to: { path: "packages/(govee|venue)", pathNot: "\\.test\\.ts$" },
    },
  ],
  options: { doNotFollow: { path: "node_modules" }, tsPreCompilationDeps: true },
};
