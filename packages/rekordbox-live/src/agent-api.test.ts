import { describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import {
  AGENT_RESOLVE_ENDPOINTS,
  pickAgentTokenSource,
  redactAgentSecrets,
  RekordboxAgentClient,
  resolveWithAgent,
  type AgentTokenSourceState,
} from "./agent-api.js";

const TOKEN = "test-session-token";

interface FakeAgent {
  server: Server;
  port: number;
  requests: string[];
}

// Local fake agent: 404 on / (alive, like the captured Express agent), bearer
// check on the resolve endpoints, one known content id, one unknown id.
async function fakeAgent(): Promise<FakeAgent> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    requests.push(url);
    if (url === "/") {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    const auth = req.headers.authorization ?? "";
    if (!url.startsWith("/api/data/")) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    if (auth !== `Bearer ${TOKEN}`) {
      res.statusCode = 401;
      res.end("unauthorized");
      return;
    }
    if (url === "/api/data/1234") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ path: "/music/track.mp3" }));
      return;
    }
    res.statusCode = 404;
    res.end("missing");
  });
  const { promise, resolve } = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => resolve());
  await promise;
  const address = server.address();
  const port = address !== null && typeof address === "object" ? address.port : 0;
  return { server, port, requests };
}

async function closeAgent(agent: FakeAgent): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  agent.server.close(() => resolve());
  await promise;
}

describe("Rekordbox agent API client (T-LIVE-08)", () => {
  it("reports the agent as present without a token", async () => {
    const agent = await fakeAgent();
    try {
      const client = new RekordboxAgentClient({ port: agent.port, timeoutMs: 500 });
      const probe = await client.probe();
      expect(probe.present).toBe(true);
      expect(probe.status).toBe(404);
      expect(client.hasToken()).toBe(false);
      expect(await client.resolveContent("1234")).toMatchObject({ ok: false, reason: "no-token" });
    } finally {
      await closeAgent(agent);
    }
  });

  it("resolves a content id once a token is adopted, and reports not-found otherwise", async () => {
    const agent = await fakeAgent();
    try {
      const client = new RekordboxAgentClient({ port: agent.port, timeoutMs: 500 });
      client.adoptToken(TOKEN, "manual");
      expect(client.hasToken()).toBe(true);
      expect(client.tokenOrigin()).toBe("manual");
      const resolved = await client.resolveContent("1234");
      expect(resolved.ok).toBe(true);
      expect(resolved.path).toBe("/music/track.mp3");
      expect(resolved.endpoint).toBe(AGENT_RESOLVE_ENDPOINTS[0]?.replace("{id}", "1234"));
      expect(await client.resolveContent("9999")).toMatchObject({ ok: false, reason: "not-found" });
      client.forgetToken();
      expect(client.hasToken()).toBe(false);
      expect(await client.resolveContent("1234")).toMatchObject({ ok: false, reason: "no-token" });
    } finally {
      await closeAgent(agent);
    }
  });

  it("reports denied when the agent rejects the token", async () => {
    const agent = await fakeAgent();
    try {
      const client = new RekordboxAgentClient({ port: agent.port, timeoutMs: 500 });
      client.adoptToken("wrong-token", "file");
      expect(await client.resolveContent("1234")).toMatchObject({ ok: false, reason: "denied" });
    } finally {
      await closeAgent(agent);
    }
  });

  it("reports not-present when nothing listens on the port", async () => {
    const client = new RekordboxAgentClient({ port: 1, timeoutMs: 300 });
    expect(await client.probe()).toMatchObject({ present: false });
    client.adoptToken(TOKEN, "manual");
    expect(await client.resolveContent("1234")).toMatchObject({ ok: false, reason: "not-present" });
  });

  it("never lets the token into a log line", async () => {
    const agent = await fakeAgent();
    try {
      const client = new RekordboxAgentClient({ port: agent.port, timeoutMs: 500 });
      client.adoptToken(TOKEN, "memory-cleanroom");
      expect(client.describeForLog()).not.toContain(TOKEN);
      expect(client.describeForLog()).toContain("memory-cleanroom");
      expect(redactAgentSecrets(`Authorization: Bearer ${TOKEN}`, TOKEN)).not.toContain(TOKEN);
      expect(redactAgentSecrets(`Authorization: Bearer ${TOKEN}`)).toBe("Authorization: Bearer [redacted]");
      expect(redactAgentSecrets("no secrets here")).toBe("no secrets here");
    } finally {
      await closeAgent(agent);
    }
  });

  it("enumerates token sources and reports the chosen one", () => {
    const sources: AgentTokenSourceState[] = [
      { source: "memory-cleanroom", available: false, detail: "consent not given" },
      { source: "file", available: true, detail: "found at userData/agent-token" },
      { source: "manual", available: false, detail: "not entered" },
    ];
    const picked = pickAgentTokenSource(sources);
    expect(picked.source).toBe("file");
    expect(picked.report).toHaveLength(3);
    expect(pickAgentTokenSource([{ source: "memory-cleanroom", available: false, detail: "consent not given" }]).source).toBeNull();
  });

  it("reports 'agent API: no token' for the DS-22 resolver step without a source", async () => {
    const agent = await fakeAgent();
    try {
      const client = new RekordboxAgentClient({ port: agent.port, timeoutMs: 500 });
      const step = await resolveWithAgent(client, "1234", [{ source: "file", available: false, detail: "no token file found" }]);
      expect(step).toMatchObject({ path: null, source: "none" });
      expect(step.report).toContain("agent API: no token");
      client.adoptToken(TOKEN, "manual");
      const withToken = await resolveWithAgent(client, "1234", [{ source: "manual", available: true, detail: "pasted by the user" }]);
      expect(withToken.source).toBe("agent-api");
      expect(withToken.path).toBe("/music/track.mp3");
    } finally {
      await closeAgent(agent);
    }
  });
});
