import type { LiveState, Route } from "../app/store.js";
import { LiveView, ControlGrid } from "../features/live/live-view.js";
import { LibraryView } from "../features/library/library-view.js";
import { InspectorView } from "../features/inspector/inspector-view.js";
import { SetupView } from "../features/setup/setup-view.js";
import { DiagnosticsView } from "../features/diagnostics/diagnostics-view.js";
import { SettingsView } from "../features/settings/settings-view.js";
import { VenueScreen } from "./venue/index.js";

// Route table (spec 83 src/routes): one entry per screen, exhaustive over the
// Route union, so a new route fails the typecheck until it has a screen. Live
// owns the performance surface and wraps its own layout. The manual lane only
// renders once a show is loaded: with no show it pushed the empty state down.
const SCREENS: Record<Route, (live: LiveState | null) => JSX.Element> = {
  live: (live) => (
    <div className="flex max-w-5xl flex-col gap-3">
      <LiveView live={live} />
      {live ? <ControlGrid /> : null}
    </div>
  ),
  library: () => <LibraryView />,
  inspector: () => <InspectorView />,
  venue: () => <VenueScreen />,
  setup: () => <SetupView />,
  diagnostics: () => <DiagnosticsView />,
  settings: () => <SettingsView />,
};

export function Routes({ route, live }: { route: Route; live: LiveState | null }): JSX.Element {
  return SCREENS[route](live);
}
