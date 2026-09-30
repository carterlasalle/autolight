import { useShell } from "../state/store.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { SETUP_STEPS } from "../venue.js";

// Setup (§100): step list with current position, no modals.
export function SetupView(): JSX.Element {
  const done: string[] = ["dj", "controller"];
  void useShell;
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-[13px]">Setup</CardTitle></CardHeader>
        <CardContent>
          <ol aria-label="Setup" className="flex list-decimal flex-col gap-1.5 pl-5 text-[13px]">
            {SETUP_STEPS.map((s) => (
              <li key={s} aria-current={done.length === SETUP_STEPS.indexOf(s) ? "step" : undefined}>
                {done.includes(s) ? "✓ " : ""}{s}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
