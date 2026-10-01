// Shared cue-type to spec 33 layer spelling. The planner tags every cue
// with this layer; the renderer's layerForCue is the fallback for legacy
// untagged cues. One spelling, two readers.
export function layerForCueName(type: string): string {
  switch (type) {
    case "static-look":
    case "section-look":
    case "gradient-look":
    case "breakdown-look":
    case "outro-release":
      return "base";
    case "orbit":
    case "perimeter-orbit":
    case "ripple":
    case "radial-pulse":
    case "opposed-pulse":
    case "converge":
    case "diverge":
    case "radar":
    case "split-alternate":
    case "quadrant-rotate":
    case "wall-step":
    case "corner-hits":
    case "fill":
    case "unfill":
    case "gradient-rotate":
    case "spiral":
    case "breathe":
    case "mirror":
    case "symmetric-sweep":
    case "spatial-wipe":
    case "group-handoff":
    case "texture-hold":
    case "chase":
    case "chase-flip":
    case "sweep":
    case "mirror-sweep":
    case "alternate":
    case "split":
    case "wave":
      return "spatial";
    case "pulse":
    case "bump":
    case "decay-hit":
    case "roll-pattern":
      return "rhythm";
    case "build-ramp":
    case "phrase-turn":
    case "fill-accent":
    case "vocal-focus":
    case "drop-pattern":
    case "final-hit":
      return "accents";
    case "impact":
    case "white-hit":
    case "blackout":
    case "dip":
    case "reveal":
    case "strobe-burst":
    case "strobe":
      return "exclusive";
    default:
      return "accents";
  }
}
