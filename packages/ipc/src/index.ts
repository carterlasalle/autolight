import { z } from "zod";

// Typed IPC API (T-ARC-02, spec 87). Every channel has a request schema, a
// response schema, a version, and a handler signature. No string-typed invoke
// in renderer code: preload exposes named functions built from this table.
// Errors return { ok: false, error: { code, message } } and surface in UI status.

const errorSchema = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() }),
});

type IpcError = z.infer<typeof errorSchema>;

function ok<T extends z.ZodRawShape>(payload: z.ZodObject<T>) {
  return z.object({ ok: z.literal(true), ...payload.shape }).passthrough();
}

const v1 = z.literal(1);

export const channels = {
  "master/blackout": {
    request: z.object({ version: v1 }),
    response: z.union([ok(z.object({ blackout: z.literal(true) })), errorSchema]),
  },
  "master/full": {
    request: z.object({ version: v1 }),
    response: z.union([ok(z.object({ full: z.literal(true) })), errorSchema]),
  },
  "master/freeze": {
    request: z.object({ version: v1, frozen: z.boolean() }),
    response: z.union([ok(z.object({ frozen: z.boolean() })), errorSchema]),
  },
  "master/intensity": {
    request: z.object({ version: v1, value: z.number().min(0).max(1) }),
    response: z.union([ok(z.object({ value: z.number().min(0).max(1) })), errorSchema]),
  },
  "master/resume": {
    request: z.object({ version: v1, at: z.enum(["beat", "bar", "phrase", "immediate"]) }),
    response: z.union([ok(z.object({ at: z.enum(["beat", "bar", "phrase", "immediate"]) })), errorSchema]),
  },
  "show/live": {
    request: z.object({ version: v1 }),
    response: z.union([
      ok(z.object({
        decks: z.array(z.object({
          state: z.unknown(),
          track: z.unknown().nullable(),
          plan: z.unknown().nullable(),
        })),
        fixtures: z.array(z.unknown()),
      })),
      errorSchema,
    ]),
  },
  "show/style": {
    request: z.object({ version: v1, style: z.string(), palette: z.string(), custom: z.boolean().optional() }),
    response: z.union([ok(z.object({ style: z.string() })), errorSchema]),
  },
  "show/energy": {
    request: z.object({
      version: v1,
      tier: z.string(),
      // Manual-lane energy options the director consumes: alternate A/B,
      // its pattern, and its speed. Optional so a bare tier change stays
      // valid.
      alternate: z.boolean().optional(),
      pattern: z.string().optional(),
      speedMs: z.number().optional(),
    }),
    response: z.union([ok(z.object({ tier: z.string() })), errorSchema]),
  },
  "show/trigger-build": {
    request: z.object({ version: v1, at: z.number().optional() }),
    response: z.union([ok(z.object({ triggered: z.literal(true) })), errorSchema]),
  },
  "show/trigger-drop": {
    request: z.object({ version: v1 }),
    response: z.union([ok(z.object({ triggered: z.literal(true) })), errorSchema]),
  },
  "show/state": {
    request: z.object({ version: v1, deck: z.number() }),
    response: z.union([ok(z.object({ deck: z.number() })), errorSchema]),
  },
  "venue/list": {
    request: z.object({ version: v1 }),
    response: z.union([ok(z.object({ fixtures: z.array(z.unknown()) })), errorSchema]),
  },
  "venue/set-color": {
    request: z.object({
      version: v1,
      rgb: z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]),
      // Explicit fixture ids (macs) from the console's per-light picker;
      // absent means every enabled fixture.
      targets: z.array(z.string().min(1)).max(16).optional(),
    }),
    response: z.union([ok(z.object({ rgb: z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]) })), errorSchema]),
  },
  "venue/segments-set": {
    request: z.object({ version: v1, id: z.string(), zones: z.number().int().min(1).max(255) }),
    response: z.union([ok(z.object({ id: z.string(), zones: z.number() })), errorSchema]),
  },
  "venue/paint-stripes": {
    request: z.object({ version: v1, id: z.string(), zones: z.number().int().min(1).max(255) }),
    response: z.union([ok(z.object({ id: z.string(), zones: z.number() })), errorSchema]),
  },
  "venue/paint-range": {
    request: z.object({
      version: v1,
      id: z.string(),
      from: z.number().int().min(0).max(255),
      to: z.number().int().min(0).max(255),
      rgb: z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]),
    }),
    response: z.union([ok(z.object({ id: z.string(), from: z.number(), to: z.number() })), errorSchema]),
  },
  "venue/device-action": {
    request: z.object({ version: v1, id: z.string(), action: z.string() }),
    response: z.union([ok(z.object({ id: z.string(), action: z.string() })), errorSchema]),
  },
  "venue/device-rename": {
    request: z.object({ version: v1, id: z.string(), name: z.string().min(1).max(48) }),
    response: z.union([ok(z.object({ id: z.string(), name: z.string() })), errorSchema]),
  },
  "venue/device-enabled": {
    request: z.object({ version: v1, id: z.string(), enabled: z.boolean() }),
    response: z.union([ok(z.object({ id: z.string(), enabled: z.boolean() })), errorSchema]),
  },
  "venue/scan": {
    request: z.object({ version: v1 }),
    response: z.union([ok(z.object({ devices: z.array(z.unknown()) })), errorSchema]),
  },
  "venue/identify": {
    request: z.object({ version: v1, id: z.string() }),
    response: z.union([ok(z.object({ id: z.string() })), errorSchema]),
  },
  "venue/test-chase": {
    request: z.object({ version: v1, id: z.string() }),
    response: z.union([ok(z.object({ id: z.string() })), errorSchema]),
  },
  "follow/ax": {
    request: z.object({ version: v1 }),
    response: z.union([ok(z.object({ readings: z.array(z.unknown()) })), errorSchema]),
  },
  "follow/mode": {
    request: z.object({ version: v1, mode: z.string() }),
    response: z.union([ok(z.object({ mode: z.string() })), errorSchema]),
  },
  "audio/devices": {
    request: z.object({ version: v1 }),
    response: z.union([ok(z.object({ devices: z.array(z.unknown()) })), errorSchema]),
  },
  "audio/level": {
    request: z.object({ version: v1 }),
    response: z.union([ok(z.object({ level: z.number() })), errorSchema]),
  },
  "diagnostics/get": {
    request: z.object({ version: v1, tab: z.string() }),
    response: z.union([ok(z.object({ tab: z.string() })), errorSchema]),
  },
  "diagnostics/all": {
    request: z.object({ version: v1 }),
    response: z.union([ok(z.object({ diagnostics: z.unknown() })), errorSchema]),
  },
  "simulator/mode": {
    request: z.object({ version: v1, enabled: z.boolean() }),
    response: z.union([ok(z.object({ enabled: z.boolean() })), errorSchema]),
  },
  "config/get": {
    request: z.object({ version: v1, key: z.string() }),
    response: z.union([
      ok(z.object({ key: z.string(), value: z.unknown(), layer: z.string(), liveSafe: z.boolean() })),
      errorSchema,
    ]),
  },
  "config/set": {
    request: z.object({
      version: v1,
      scope: z.enum(["app", "venue", "device", "style", "session"]),
      key: z.string(),
      value: z.unknown(),
    }),
    response: z.union([
      ok(z.object({ key: z.string(), scope: z.enum(["app", "venue", "device", "style", "session"]), value: z.unknown(), layer: z.string() })),
      errorSchema,
    ]),
  },
  "config/reset": {
    request: z.object({
      version: v1,
      scope: z.enum(["app", "venue", "device", "style", "session"]),
      key: z.string(),
    }),
    response: z.union([ok(z.object({ key: z.string(), scope: z.enum(["app", "venue", "device", "style", "session"]) })), errorSchema]),
  },
  "config/export": {
    request: z.object({ version: v1 }),
    response: z.union([ok(z.object({ json: z.string() })), errorSchema]),
  },
  "config/import": {
    request: z.object({ version: v1, json: z.string() }),
    response: z.union([ok(z.object({ applied: z.number().int().nonnegative() })), errorSchema]),
  },
  "config/schema": {
    request: z.object({ version: v1, key: z.string().optional() }),
    response: z.union([
      ok(
        z.object({
          keys: z.array(
            z.object({
              key: z.string(),
              type: z.string(),
              scope: z.string(),
              unit: z.string(),
              range: z.string(),
              liveSafe: z.boolean(),
            }),
          ),
        }),
      ),
      errorSchema,
    ]),
  },
} as const;

export type Channel = keyof typeof channels;

export type ChannelRequest<C extends Channel> = z.infer<(typeof channels)[C]["request"]>;

export type ChannelResponse<C extends Channel> = z.infer<(typeof channels)[C]["response"]>;

// Contract test helper (T-TRU-03): enumerate every channel with a valid
// request so integration tests can assert channel-specific side effects.
export function channelNames(): Channel[] {
  return Object.keys(channels) as Channel[];
}

// Renderer-side typed caller: validates the response, never swallows errors
// into undefined. Throws a code-carrying Error on { ok: false } so callers can
// branch on E_* failures (permission, transport, validation) like the header
// contract promises.
export type IpcCallError = Error & { code: string };

export async function callChannel<C extends Channel>(
  invokeFn: (channel: string, payload: unknown) => Promise<unknown>,
  channel: C,
  request: ChannelRequest<C>,
): Promise<Extract<ChannelResponse<C>, { ok: true }>> {
  const table = (channels as Record<string, (typeof channels)[Channel] | undefined>)[channel];

  if (table === undefined) {
    const err = new Error(`E_UNKNOWN_CHANNEL: ${channel}`) as IpcCallError;
    err.code = "E_UNKNOWN_CHANNEL";
    throw err;
  }

  let parsed: ChannelRequest<C>;

  try {
    parsed = table.request.parse(request) as ChannelRequest<C>;
  } catch (err) {
    throw toCallError("E_INVALID_REQUEST", err);
  }

  let raw: unknown;

  try {
    raw = await invokeFn(channel, parsed);
  } catch (err) {
    throw toCallError("E_INVOKE", err);
  }

  let res: ChannelResponse<C>;

  try {
    res = table.response.parse(raw) as ChannelResponse<C>;
  } catch (err) {
    throw toCallError("E_INVALID_RESPONSE", err);
  }

  if (!res.ok) {
    const err = new Error(`${(res as IpcError).error.code}: ${(res as IpcError).error.message}`) as IpcCallError;
    err.code = (res as IpcError).error.code;
    throw err;
  }

  return res as Extract<ChannelResponse<C>, { ok: true }>;
}

function toCallError(code: string, err: unknown): IpcCallError {
  const message = err instanceof Error ? err.message : String(err);
  const out = new Error(`${code}: ${message}`) as IpcCallError;
  out.code = code;
  if (err instanceof Error && err.stack !== undefined) out.stack = err.stack;

  return out;
}
