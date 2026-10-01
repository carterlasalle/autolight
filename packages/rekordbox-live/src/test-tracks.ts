// Shared virtual tracks for live provider tests: committed, license-safe
// synthetic titles (never real library rows) so generation and leak checks
// compare distinct track texts deterministically.
export const VIRTUAL_TRACK_A = { id: "virtual-a", title: "Virtual Track A", artist: "Suite" } as const;
export const VIRTUAL_TRACK_B = { id: "virtual-b", title: "Virtual Track B", artist: "Suite" } as const;
