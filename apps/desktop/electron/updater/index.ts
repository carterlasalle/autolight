// Update strategy (T-OPS-04, F-OPS-04, spec 145).
// Updates are checked only when update.checkOnLaunch is on and never
// installed while Live is active or a show is loaded. An available update
// during Live is deferred with a status notice and no modal (spec 144).

export interface UpdateCheckOptions {
  checkOnLaunch: boolean;
  liveActive: boolean;
  showLoaded: boolean;
}

export type UpdateDecision =
  | { action: "check"; note: string }
  | { action: "skip-disabled"; note: string }
  | { action: "defer-live"; note: string };

/** One gate for every update decision: never install while Live or a show. */
function updateGateOpen(liveActive: boolean, showLoaded: boolean): boolean {
  return !liveActive && !showLoaded;
}

export function decideUpdateCheck(options: UpdateCheckOptions): UpdateDecision {
  // Disabled wins the report: "deferred" would overstate a system that is
  // off (batch-17).
  if (!options.checkOnLaunch) {
    return { action: "skip-disabled", note: "update check off (update.checkOnLaunch)" };
  }

  if (!updateGateOpen(options.liveActive, options.showLoaded)) {
    return {
      action: "defer-live",
      note: "update deferred: Live is active or a show is loaded (spec 145); status notice, no modal",
    };
  }

  return { action: "check", note: "checking for updates at launch" };
}

export interface UpdateState {
  available: string | null;
  deferred: boolean;
  notice: string | null;
}

export function noteUpdateAvailable(version: string, liveActive: boolean, showLoaded = false): UpdateState {
  // The same gate canInstallUpdate enforces: an update arriving while a show
  // is loaded must read as deferred (batch-17).
  if (!updateGateOpen(liveActive, showLoaded)) {
    return {
      available: version,
      deferred: true,
      notice: `update ${version} available; install after ${liveActive ? "Live" : "the show"} ends (status notice only, spec 144)`,
    };
  }

  return { available: version, deferred: false, notice: `update ${version} available` };
}

export function canInstallUpdate(liveActive: boolean, showLoaded: boolean): boolean {
  return updateGateOpen(liveActive, showLoaded);
}
