// TEST-BUILD ONLY contract (T-QA-02): the journey-facing test API shape,
// shared by the --test main bundle (registerTestApi implementation) and the
// e2e harness (consumer) so both sides stay pinned to one contract instead
// of parallel unknown-typed records. Pure types — erased at build time and
// never present in release artifacts (bundle-scan enforces that).

import type { SimulatorShow } from "./services/simulator-show.js";

export interface TestApiStage {
  name: string;
  atMs: number;
}

export interface TestApiLibrary {
  tracks: { id: string; readiness: string }[];
}

// Simulator method results, derived from the class itself so the contract
// cannot drift from the implementation.
type SimulatorReturn<M extends keyof SimulatorShow> = Awaited<ReturnType<SimulatorShow[M]>>;

export interface TestApi {
  stages: () => Promise<TestApiStage[]>;
  library: () => Promise<TestApiLibrary>;
  fixtures: () => Promise<SimulatorReturn<"fixtureInfo">>;
  decks: () => Promise<SimulatorReturn<"decks">>;
  plan: () => Promise<SimulatorReturn<"planInfo">>;
  frames: () => Promise<SimulatorReturn<"frames">>;
  commands: () => Promise<SimulatorReturn<"commands">>;
  snapshot: () => Promise<SimulatorReturn<"snapshot">>;
  "resume-status": () => Promise<SimulatorReturn<"resumeStatus">>;
  "freeze-renderer": (arg?: { ms?: number }) => Promise<SimulatorReturn<"freezeRenderer">>;
  key: (arg?: { key?: string }) => Promise<SimulatorReturn<"key">>;
  shutdown: () => Promise<SimulatorReturn<"shutdown">>;
}

export type TestApiMethod = keyof TestApi;

export type TestApiArg<M extends TestApiMethod> = Parameters<TestApi[M]>[0];

export type TestApiResult<M extends TestApiMethod> = Awaited<ReturnType<TestApi[M]>>;

/**
 * Channels the acceptance specs call before their surface is wired (T-QA-11
 * remaining work). They are deliberately NOT part of TestApi: the main-side
 * dispatcher fails them explicitly, so `normal-night.spec.ts` stays red by
 * design rather than silently passing.
 */
export type UnwiredTestChannel = "normal-night-row";

export type TestApiChannel = TestApiMethod | UnwiredTestChannel;

// Per-channel arg/result tables derived from the contract so nothing can
// drift; the unwired channel can never produce a value (never).
export type TestApiChannelArgMap = { [K in TestApiMethod]: TestApiArg<K> } & { "normal-night-row": { row?: string } | undefined };

export type TestApiChannelResultMap = { [K in TestApiMethod]: TestApiResult<K> } & { "normal-night-row": never };

export type TestApiChannelArg<M extends TestApiChannel> = TestApiChannelArgMap[M];

export type TestApiChannelResult<M extends TestApiChannel> = TestApiChannelResultMap[M];
