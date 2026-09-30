import { z } from "zod";

// Typed IPC API (T-ARC-02, spec 87). Every channel has a request schema, a
// response schema, a version, and a handler signature. No string-typed invoke
// in renderer code: preload exposes named functions built from this table.
// Errors return { ok: false, error: { code, message } } and surface in UI status.

export const errorSchema = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() }),
});
export type IpcError = z.infer<typeof errorSchema>;

function ok<T extends z.ZodRawShape>(payload: z.ZodObject<T>) {
  return z.object({ ok: z.literal(true), ...payload.shape });
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
    response: z.union([ok(z.object({ value: z.number() })), errorSchema]),
  },
  "master/resume": {
    request: z.object({ version: v1, at: z.enum(["beat", "bar", "phrase", "immediate"]) }),
    response: z.union([ok(z.object({ at: z.string() })), errorSchema]),
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
    request: z.object({ version: v1, style: z.string(), palette: z.string() }),
    response: z.union([ok(z.object({ style: z.string() })), errorSchema]),
  },
  "show/energy": {
    request: z.object({ version: v1, tier: z.string() }),
    response: z.union([ok(z.object({ tier: z.string() })), errorSchema]),
  },
  "show/trigger-build": {
    request: z.object({ version: v1 }),
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
    request: z.object({ version: v1, rgb: z.tuple([z.number(), z.number(), z.number()]) }),
    response: z.union([ok(z.object({ rgb: z.tuple([z.number(), z.number(), z.number()]) })), errorSchema]),
  },
  "venue/device-action": {
    request: z.object({ version: v1, id: z.string(), action: z.string() }),
    response: z.union([ok(z.object({ id: z.string(), action: z.string() })), errorSchema]),
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
      ok(z.object({ key: z.string(), scope: z.string(), value: z.unknown(), layer: z.string() })),
      errorSchema,
    ]),
  },
  "config/reset": {
    request: z.object({
      version: v1,
      scope: z.enum(["app", "venue", "device", "style", "session"]),
      key: z.string(),
    }),
    response: z.union([ok(z.object({ key: z.string(), scope: z.string() })), errorSchema]),
  },
  "config/export": {
    request: z.object({ version: v1 }),
    response: z.union([ok(z.object({ json: z.string() })), errorSchema]),
  },
  "config/import": {
    request: z.object({ version: v1, json: z.string() }),
    response: z.union([ok(z.object({ applied: z.number() })), errorSchema]),
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

export type Handler<C extends Channel> = (
  request: ChannelRequest<C>,
) => Promise<ChannelResponse<C>> | ChannelResponse<C>;

// Contract test helper (T-TRU-03): enumerate every channel with a valid
// request so integration tests can assert channel-specific side effects.
export function channelNames(): Channel[] {
  return Object.keys(channels) as Channel[];
}

// Renderer-side typed caller: validates the response, never swallows errors
// into undefined. Throws IpcError-shaped Error on { ok: false }.
export async function callChannel<C extends Channel>(
  invokeFn: (channel: string, payload: unknown) => Promise<unknown>,
  channel: C,
  request: ChannelRequest<C>,
): Promise<Extract<ChannelResponse<C>, { ok: true }>> {
  const parsed = channels[channel].request.parse(request);
  const raw = await invokeFn(channel, parsed);
  const res = channels[channel].response.parse(raw) as ChannelResponse<C>;
  if (!res.ok) {
    throw new Error(`${(res as IpcError).error.code}: ${(res as IpcError).error.message}`);
  }
  return res as Extract<ChannelResponse<C>, { ok: true }>;
}
