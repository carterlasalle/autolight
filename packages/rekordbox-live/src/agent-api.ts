// Rekordbox local agent API client (T-LIVE-08, F-LIVE-09).
//
// The Rekordbox agent listens on live.agentApi.port (30001 by default). It is
// alive when it answers HTTP at all (the capture log shows Express 404s on /,
// /api/* and /api/data/*); resolving a content ID to a file path requires the
// session bearer token, as rkbx_os2l documents (no code is taken from it).
//
// The token is a secret: it is held in memory only, never logged, and every
// log line this module produces goes through `redactAgentSecrets`. Token
// sources are enumerated and each is reported: the clean-room memory reader
// (consent required, T-LIVE-11), a token file location (recorded by
// HW-RB-AGENT-01), and manual entry.
import { request } from "node:http";
import { z } from "zod";

export type AgentTokenSource = "memory-cleanroom" | "file" | "manual";

export interface AgentTokenSourceState {
  source: AgentTokenSource;
  available: boolean;
  detail: string;
}

export interface AgentProbe {
  present: boolean;
  status: number | null;
  reason: string;
}

export interface AgentResolution {
  ok: boolean;
  path: string | null;
  endpoint: string | null;
  reason: "resolved" | "no-token" | "not-present" | "not-found" | "denied" | "malformed";
}

export interface AgentClientOptions {
  host?: string;
  port?: number;
  timeoutMs?: number;
}

// Candidate endpoints, tried in order. HW-RB-AGENT-01 records which one the
// installed agent actually answers, so this list can be narrowed to the real
// one; the client reports the endpoint it used on every resolution.
export const AGENT_RESOLVE_ENDPOINTS: readonly string[] = [
  "/api/data/{id}",
  "/api/data/{id}/path",
  "/api/data/track/{id}",
];

const PATH_KEYS = ["path", "filePath", "absolutePath", "contentPath"] as const;

const agentPathSchema = z.object({
  path: z.string().optional(),
  filePath: z.string().optional(),
  absolutePath: z.string().optional(),
  contentPath: z.string().optional(),
});

export function redactAgentSecrets(text: string, token: string | null = null): string {
  let out = text.replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]");
  if (token !== null && token.length > 0) out = out.split(token).join("[redacted]");
  return out;
}

export function pickAgentTokenSource(states: readonly AgentTokenSourceState[]): { source: AgentTokenSource | null; report: string[] } {
  const report = states.map((s) => `${s.source}: ${s.available ? `available (${s.detail})` : `unavailable (${s.detail})`}`);
  const chosen = states.find((s) => s.available);
  return { source: chosen?.source ?? null, report };
}

export class RekordboxAgentClient {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private token: string | null = null;
  private tokenSource: AgentTokenSource | null = null;

  constructor(opts: AgentClientOptions = {}) {
    this.host = opts.host ?? "127.0.0.1";
    this.port = opts.port ?? 30001;
    this.timeoutMs = opts.timeoutMs ?? 1000;
  }

  hasToken(): boolean {
    return this.token !== null;
  }

  tokenOrigin(): AgentTokenSource | null {
    return this.tokenSource;
  }

  // Memory only: never written to disk, never logged.
  adoptToken(token: string, source: AgentTokenSource): void {
    this.token = token.length > 0 ? token : null;
    this.tokenSource = token.length > 0 ? source : null;
  }

  forgetToken(): void {
    this.token = null;
    this.tokenSource = null;
  }

  describeForLog(): string {
    return `agent api ${this.host}:${this.port} token ${this.hasToken() ? `present from ${this.tokenSource}` : "absent"}`;
  }

  // Liveness without a token: any HTTP answer means the agent is present.
  async probe(): Promise<AgentProbe> {
    const response = await this.get("/");
    if (response === null) return { present: false, status: null, reason: `no answer on ${this.host}:${this.port}` };
    return { present: true, status: response.status, reason: `agent answered HTTP ${response.status}` };
  }

  async resolveContent(contentId: string): Promise<AgentResolution> {
    if (this.token === null) return { ok: false, path: null, endpoint: null, reason: "no-token" };
    let sawResponse = false;
    for (const candidate of AGENT_RESOLVE_ENDPOINTS) {
      const endpoint = candidate.replace("{id}", encodeURIComponent(contentId));
      const response = await this.get(endpoint, this.token);
      if (response === null) continue;
      sawResponse = true;
      if (response.status === 401 || response.status === 403) return { ok: false, path: null, endpoint, reason: "denied" };
      if (response.status === 404) continue;
      if (response.status >= 400) continue;
      const path = parsePathBody(response.body);
      if (path === null) return { ok: false, path: null, endpoint, reason: "malformed" };
      return { ok: true, path, endpoint, reason: "resolved" };
    }
    return sawResponse
      ? { ok: false, path: null, endpoint: null, reason: "not-found" }
      : { ok: false, path: null, endpoint: null, reason: "not-present" };
  }

  private get(path: string, token?: string): Promise<{ status: number; body: string } | null> {
    const { promise, resolve } = Promise.withResolvers<{ status: number; body: string } | null>();
    const req = request(
      {
        host: this.host,
        port: this.port,
        path,
        method: "GET",
        timeout: this.timeoutMs,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        res.on("error", () => resolve(null));
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
    req.end();
    return promise;
  }
}

function parsePathBody(body: string): string | null {
  try {
    const parsed = agentPathSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return null;
    for (const key of PATH_KEYS) {
      const value = parsed.data[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
    return null;
  } catch {
    return null;
  }
}

export interface AgentResolverStep {
  path: string | null;
  source: "agent-api" | "none";
  report: string;
}

// DS-22 resolver step: uses the agent when a token source is available and
// reports "agent API: no token" otherwise.
export async function resolveWithAgent(
  client: RekordboxAgentClient,
  contentId: string,
  sources: readonly AgentTokenSourceState[],
): Promise<AgentResolverStep> {
  const { source, report } = pickAgentTokenSource(sources);
  if (source === null) {
    return { path: null, source: "none", report: `agent API: no token (${report.join("; ")})` };
  }
  if (!client.hasToken()) {
    return { path: null, source: "none", report: `agent API: no token loaded from ${source} (${report.join("; ")})` };
  }
  const resolution = await client.resolveContent(contentId);
  if (!resolution.ok) {
    return { path: null, source: "none", report: `agent API: ${resolution.reason} via ${resolution.endpoint ?? "no endpoint"}` };
  }
  return { path: resolution.path, source: "agent-api", report: `agent API: resolved via ${resolution.endpoint ?? "unknown endpoint"}` };
}
