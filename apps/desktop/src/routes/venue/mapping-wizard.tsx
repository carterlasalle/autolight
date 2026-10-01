import { useState } from "react";
import { mirrorCheck } from "@autolight/venue";
import type { RunTopology } from "@autolight/venue";

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

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

export function MappingWizard({ onDone }: { onDone: (topology: RunTopology) => void }): JSX.Element {
  const [step, setStep] = useState<WizardStep>(1);
  const [direction, setDirection] = useState<"clockwise" | "counterclockwise" | "both">("clockwise");
  const [places, setPlaces] = useState(1);
  const check = mirrorCheck(places);
  return (
    <section aria-label="Strip mapping wizard" className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold">Strip mapping wizard (step {step} of 10)</h2>
      <p className="text-[13px]">{STEP_LABELS[step]}</p>
      {step === 3 ? (
        <div className="flex gap-2" role="radiogroup" aria-label="Comet direction">
          {(["clockwise", "counterclockwise", "both"] as const).map((d) => (
            <label key={d} className="flex items-center gap-1.5 text-[13px]">
              <input type="radio" name="comet" checked={direction === d} onChange={() => setDirection(d)} />
              {d === "both" ? "both ways at once (split)" : d}
            </label>
          ))}
        </div>
      ) : null}
      {step === 7 ? (
        <div className="flex flex-col gap-1">
          <label className="text-[13px]">
            Places the lit cell appears
            <input
              type="number"
              min={1}
              max={4}
              value={places}
              aria-label="Places the lit cell appears"
              onChange={(e) => setPlaces(Math.max(1, Number(e.target.value) || 1))}
              className="ml-2 w-16 rounded border px-1"
            />
          </label>
          <p className="text-[13px]">{check.note}</p>
          <p className="text-[13px]">Offered: {check.offered.join(", ")}</p>
        </div>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={step <= 1}
          onClick={() => setStep((Math.max(1, step - 1)) as WizardStep)}
          className="rounded border px-2 py-1 text-[13px]"
        >
          Back
        </button>
        {step < 10 ? (
          <button
            type="button"
            onClick={() => setStep((Math.min(10, step + 1)) as WizardStep)}
            className="rounded border px-2 py-1 text-[13px]"
          >
            Next
          </button>
        ) : (
          <button type="button" onClick={() => onDone(check.topology)} className="rounded border px-2 py-1 text-[13px]">
            Save mapping
          </button>
        )}
      </div>
      {step === 3 && direction === "both" ? (
        <p className="text-[13px]">Split detected at the direction step; the fit will map each run on its own.</p>
      ) : null}
    </section>
  );
}
