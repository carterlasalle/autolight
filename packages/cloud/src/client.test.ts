// T-CLD-01 cloud metadata client tests: sanitised recorded responses,
// limit accounting, show-tick rejection, and disabled-by-default stance.
// No live call: every response is a literal in this file.
import { describe, expect, it } from "vitest";
import {
  API_KEY_HEADER,
  CLOUD_BASE,
  CLOUD_CARRIES_FRAMES,
  CloudApiError,
  CloudDisabledError,
  CloudFrameRejectedError,
  CloudMetadataClient,
  CloudRateLimitError,
  DEVICES_PATH,
  parseDeviceEntry,
  parseRateHeaders,
  type CloudFetchRequest,
} from "./client.js";

function ok(body: string, headers: Record<string, string> = {}, seen: CloudFetchRequest[] = []) {
  return {
    seen,
    fetchFn: async (req: CloudFetchRequest) => {
      seen.push(req);
      return { status: 200, headers, body };
    },
  };
}

const DEVICES_BODY = JSON.stringify({
  data: [
    {
      device: "AA:BB:CC:DD:EE:01",
      model: "H6076",
      deviceName: "Desk Strip",
      controllable: true,
      retrievable: true,
      supportCmds: ["turn", "brightness", "color", "colorTem"],
      properties: { segments: 14 },
    },
    {
      device: "AA:BB:CC:DD:EE:02",
      model: "H1A45",
      deviceName: "Ceiling",
      controllable: true,
      retrievable: false,
      supportCmds: ["turn", "brightness"],
      properties: {},
    },
  ],
});

const SCENES_BODY = JSON.stringify({
  data: [
    { sceneId: "s1", name: "Sunset" },
    { id: "s2", name: "Ocean" },
  ],
});

function enabled(over: Partial<ConstructorParameters<typeof CloudMetadataClient>[0]> = {}) {
  const stub = ok(DEVICES_BODY);
  const client = new CloudMetadataClient({
    apiKey: "secret",
    fetchFn: stub.fetchFn,
    enabled: true,
    cloudAllowed: true,
    ...over,
  });
  return { client, seen: stub.seen };
}

describe("cloud metadata client", () => {
  it("lists devices from a recorded response with declared counts and names", async () => {
    const { client } = enabled();
    const devices = await client.listDevices();
    expect(devices).toHaveLength(2);
    expect(devices[0]).toMatchObject({
      deviceId: "AA:BB:CC:DD:EE:01",
      model: "H6076",
      name: "Desk Strip",
    });
    expect(devices[0]?.capabilities.declaredSegmentCount).toBe(14);
    expect(devices[0]?.capabilities.instances).toEqual(["turn", "brightness", "color", "colorTem"]);
    expect(devices[1]?.capabilities.declaredSegmentCount).toBeNull();
  });

  it("sends the API key as a header and hits the device list URL", async () => {
    const { client, seen } = enabled();
    await client.listDevices();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(`${CLOUD_BASE}${DEVICES_PATH}`);
    expect(seen[0]?.method).toBe("GET");
    expect(seen[0]?.headers[API_KEY_HEADER]).toBe("secret");
  });

  it("never interpolates the key into an error message", async () => {
    const client = new CloudMetadataClient({
      apiKey: "super-secret-key",
      fetchFn: async () => ({ status: 500, headers: {}, body: JSON.stringify({ message: "boom" }) }),
      enabled: true,
      cloudAllowed: true,
    });
    await expect(client.listDevices()).rejects.toBeInstanceOf(CloudApiError);
    await expect(client.listDevices()).rejects.toThrowError(/status 500/);
    try {
      await client.listDevices();
    } catch (err) {
      expect(String(err)).not.toContain("super-secret-key");
    }
  });

  it("lists scenes from a recorded catalogue response", async () => {
    const stub = ok(SCENES_BODY);
    const client = new CloudMetadataClient({
      apiKey: "secret",
      fetchFn: stub.fetchFn,
      enabled: true,
      cloudAllowed: true,
    });
    const scenes = await client.listScenes("AA:BB:CC:DD:EE:01", "H6076");
    expect(scenes).toEqual([
      { sceneId: "s1", name: "Sunset" },
      { sceneId: "s2", name: "Ocean" },
    ]);
  });

  it("is disabled unless both govee.cloud.enabled and security.cloudAllowed hold", async () => {
    const offStub = ok(DEVICES_BODY);
    const off = new CloudMetadataClient({ apiKey: "k", fetchFn: offStub.fetchFn });
    await expect(off.listDevices()).rejects.toBeInstanceOf(CloudDisabledError);
    const halfStub = ok(DEVICES_BODY);
    const half = new CloudMetadataClient({
      apiKey: "k",
      fetchFn: halfStub.fetchFn,
      enabled: true,
      cloudAllowed: false,
    });
    await expect(half.listDevices()).rejects.toBeInstanceOf(CloudDisabledError);
  });

  it("rejects any call scheduled from the show tick, even when enabled", async () => {
    const { client } = enabled();
    await expect(client.listDevices({ fromShowTick: true })).rejects.toBeInstanceOf(
      CloudFrameRejectedError,
    );
    expect(CLOUD_CARRIES_FRAMES).toBe(false);
  });

  it("enforces the per-device minute budget from configuration", async () => {
    let at = 1_000_000;
    const stub = ok(DEVICES_BODY);
    const client = new CloudMetadataClient({
      apiKey: "k",
      fetchFn: stub.fetchFn,
      enabled: true,
      cloudAllowed: true,
      perDevicePerMinute: 2,
      perAccountPerDay: 10000,
      now: () => at,
    });
    await client.listDevices({ deviceKey: "lamp" });
    await client.listDevices({ deviceKey: "lamp" });
    await expect(client.listDevices({ deviceKey: "lamp" })).rejects.toBeInstanceOf(CloudRateLimitError);
    at += 61_000;
    await client.listDevices({ deviceKey: "lamp" });
  });

  it("enforces the per-account day budget from configuration", async () => {
    const at = 1_000_000;
    const stub = ok(DEVICES_BODY);
    const client = new CloudMetadataClient({
      apiKey: "k",
      fetchFn: stub.fetchFn,
      enabled: true,
      cloudAllowed: true,
      perDevicePerMinute: 100,
      perAccountPerDay: 1,
      now: () => at,
    });
    await client.listDevices({ deviceKey: "a" });
    await expect(client.listDevices({ deviceKey: "b" })).rejects.toBeInstanceOf(CloudRateLimitError);
  });

  it("accounts server headers and surfaces retry-after on 429", async () => {
    const stub = ok(DEVICES_BODY, {
      "X-RateLimit-Remaining-Minute": "7",
      "X-RateLimit-Remaining-Day": "9000",
    });
    const client = new CloudMetadataClient({
      apiKey: "k",
      fetchFn: stub.fetchFn,
      enabled: true,
      cloudAllowed: true,
    });
    await client.listDevices();
    expect(client.accounting.lastServerMinuteRemaining).toBe(7);
    expect(client.accounting.lastServerDayRemaining).toBe(9000);

    const limited = new CloudMetadataClient({
      apiKey: "k",
      fetchFn: async () => ({ status: 429, headers: { "Retry-After": "30" }, body: "{}" }),
      enabled: true,
      cloudAllowed: true,
    });
    const err = await limited.listDevices().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloudRateLimitError);
    if (err instanceof CloudRateLimitError) {
      expect(err.retryAfterMs).toBe(30_000);
    }
    expect(limited.accounting.lastRetryAfterMs).toBe(30_000);
  });
  it("parses rate headers case-insensitively and ignores garbage", () => {
    expect(parseRateHeaders({ "X-RATELIMIT-REMAINING-MINUTE": "3" }).minuteRemaining).toBe(3);
    expect(parseRateHeaders({ "x-ratelimit-remaining-day": "nope" }).dayRemaining).toBeNull();
    expect(parseRateHeaders({}).retryAfterMs).toBeNull();
  });

  it("leaves the declared count null when the entry claims none, and takes the first known key", () => {
    const bare = parseDeviceEntry({
      device: "d",
      model: "m",
      deviceName: "n",
      controllable: true,
      retrievable: true,
      supportCmds: [],
    });
    expect(bare.capabilities.declaredSegmentCount).toBeNull();
    const zoned = parseDeviceEntry({
      device: "d",
      model: "m",
      deviceName: "n",
      controllable: true,
      retrievable: true,
      supportCmds: [],
      properties: { zoneCount: 8.9 },
    });
    expect(zoned.capabilities.declaredSegmentCount).toBe(8);
  });
});
