// T-UI-01 design tokens (spec 88): deep neutral surface, one restrained
// accent family, semantic status colours, mono timing type, dense spacing,
// fast motion. Tailwind utility classes render the spec-88 look; these
// constants exist so components share one vocabulary instead of repeating
// literal class strings, type sizes, hex colours or durations.
//
// token() emits Tailwind class strings; the --color-* variables come from
// styles/globals.css (dark theme above light, spec 88 deep neutral dark).

export namespace tokens {
  // Surface: dense order, deep neutral background, minimal chrome.
  export const surface = "bg-background text-foreground";
  export const panel = "rounded-xl bg-card ring-1 ring-foreground/10";
  export const subtle = "text-muted-foreground";
  export const card = "bg-card text-card-foreground";

  // The one restrained accent family.
  export const accent = "text-primary";
  export const accentSoft = "text-primary/80";

  // Semantic status colours never carry meaning alone: icons and text
  // accompany every dot (spec 88, rule: no colour-only states).
  export const statusOk = "var(--ok)";
  export const statusWarn = "var(--warn)";
  export const statusBad = "var(--bad)";
  export const statusIdle = "var(--muted-foreground)";

  // Type scale: large timing typography, dense body.
  export const type = {
    body: "text-sm",
    small: "text-xs",
    caption: "text-xs",
    timing: "font-timing tabular-nums",
    timingLarge: "font-timing text-5xl font-semibold tabular-nums",
  } as const;

  // Spacing: dense.
  export const space = {
    gap: "gap-3",
    gapTight: "gap-2",
    gapTighter: "gap-1.5",
    padding: "p-3",
    paddingTight: "px-2.5 py-1.5",
  } as const;

  // Motion: fast, 60 fps friendly; transform-friendly properties only.
  export const motion = {
    fast: "transition-[background-color,color,opacity,transform] duration-150",
    hover: "hover:bg-muted",
  } as const;
}