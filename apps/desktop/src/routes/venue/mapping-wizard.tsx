import { useState } from "react";
import { classifyDirection, mirrorCheck } from "@autolight/venue";
import type { RunTopology } from "@autolight/venue";

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type WizardDirectionAnswer = "clockwise" | "counterclockwise" | "both";

const MIN_PLACES = 1;
const MAX_PLACES = 4;

const STEP_LABELS: Record<WizardStep, string> = {
  1: "Choose the strip and confirm it follows the room outline",
  2: "Click where the controller is on the path",
  3: "Direction: which way did the comet travel?",
  4: "Ends: click where the last cell appears",
  5: "Corners: stop the lit cell at each corner",
  6: "Gaps: mark LED-free spans (optional)",
  7: "Mirroring check: click every place the lit cell appears",
  8: "Fit: arc-length mapping through the anchors",
  9: "Verify: slow orbit, confirm continuous",
  10: "Save to device calibrations",
};

// Steps 6 (gaps are optional) and 10 (the save step) carry no confirmation.
const REQUIRED_STEPS: readonly WizardStep[] = [1, 2, 3, 4, 5, 7, 8, 9];

/** Both bounds of the places input; the HTML `max` attribute cannot clamp typed text. */
function clampPlaces(value: string): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return MIN_PLACES;

  return Math.min(MAX_PLACES, Math.max(MIN_PLACES, Math.trunc(parsed)));
}

/** The persisted topology: "both" is a split run, whatever the mirror check counted. */
function wizardTopology(direction: WizardDirectionAnswer, places: number): RunTopology {
  if (direction === "both") return classifyDirection(direction);

  return mirrorCheck(places).topology;
}

export function MappingWizard({
  onDone,
  initialStep = 1,
  initialDirection = "clockwise",
  initialConfirmed = [],
}: {
  onDone: (topology: RunTopology) => void;
  initialStep?: WizardStep;
  initialDirection?: WizardDirectionAnswer;
  initialConfirmed?: readonly WizardStep[];
}): JSX.Element {
  const [step, setStep] = useState<WizardStep>(initialStep);
  const [direction, setDirection] = useState<WizardDirectionAnswer>(initialDirection);
  const [places, setPlaces] = useState(MIN_PLACES);
  const [confirmed, setConfirmed] = useState<readonly WizardStep[]>(initialConfirmed);
  const check = mirrorCheck(places);
  const topology = wizardTopology(direction, places);
  const stepConfirmed = confirmed.includes(step);
  const saveEnabled = REQUIRED_STEPS.every((required) => confirmed.includes(required));

  const setStepConfirmed = (next: boolean) => {
    setConfirmed((current) => {
      if (next) return current.includes(step) ? current : [...current, step];

      return current.filter((value) => value !== step);
    });
  };

  return (
    <section aria-label="Strip mapping wizard" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Strip mapping wizard (step {step} of 10)</h2>
      <p className="text-sm">{STEP_LABELS[step]}</p>
      {step === 3 ? (
        <div className="flex gap-2" role="radiogroup" aria-label="Comet direction">
          {(["clockwise", "counterclockwise", "both"] as const).map((d) => (
            <label key={d} className="flex items-center gap-1.5 text-sm">
              <input type="radio" name="comet" checked={direction === d} onChange={() => setDirection(d)} />
              {d === "both" ? "both ways at once (split)" : d}
            </label>
          ))}
        </div>
      ) : null}
      {step === 7 ? (
        <div className="flex flex-col gap-1">
          <label className="text-sm">
            Places the lit cell appears
            <input
              type="number"
              min={MIN_PLACES}
              max={MAX_PLACES}
              value={places}
              aria-label="Places the lit cell appears"
              onChange={(e) => setPlaces(clampPlaces(e.target.value))}
              className="ml-2 w-16 rounded border px-1"
            />
          </label>
          <p className="text-sm">{check.note}</p>
          <p className="text-sm">Offered: {check.offered.join(", ")}</p>
        </div>
      ) : null}
      {REQUIRED_STEPS.includes(step) ? (
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={stepConfirmed}
            aria-label={`Confirmed step ${step}`}
            onChange={(e) => setStepConfirmed(e.target.checked)}
          />
          Confirmed: this step is done
        </label>
      ) : null}
      {step === 10 ? <p className="text-sm">Saved topology: {topology}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={step <= 1}
          onClick={() => setStep((Math.max(1, step - 1)) as WizardStep)}
          className="rounded border px-2 py-1 text-sm"
        >
          Back
        </button>
        {step < 10 ? (
          <button
            type="button"
            disabled={REQUIRED_STEPS.includes(step) && !stepConfirmed}
            onClick={() => setStep((Math.min(10, step + 1)) as WizardStep)}
            className="rounded border px-2 py-1 text-sm"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            disabled={!saveEnabled}
            onClick={() => onDone(topology)}
            className="rounded border px-2 py-1 text-sm"
          >
            Save mapping
          </button>
        )}
      </div>
      {step === 3 && direction === "both" ? (
        <p className="text-sm">Split detected at the direction step; the fit will map each run on its own.</p>
      ) : null}
    </section>
  );
}
