# T-LIVE-08: Rekordbox local agent API client (port 30001)

Closes F-LIVE-09.

## What changed

- `packages/rekordbox-live/src/agent-api.ts`:
  - `RekordboxAgentClient.probe()` reports "agent present" from an HTTP answer
    with no token, which matches the captured agent (Express answers 404 on `/`,
    `/api/*` and `/api/data/*`, which is a live agent, not a transport).
  - `resolveContent()` adds the session bearer token and walks the candidate
    resolve endpoints in order, returning `resolved`, `no-token`, `not-present`,
    `not-found`, `denied` or `malformed`, and always naming the endpoint it used
    so `HW-RB-AGENT-01` can record which one the installed agent answers.
  - The token is held in memory only (`adoptToken`, `forgetToken`), is never
    written or logged, and everything the module can emit goes through
    `redactAgentSecrets`.
  - Token sources are enumerated and each is reported:
    `memory-cleanroom` (consent required, T-LIVE-11), `file` (a token file
    location recorded by `HW-RB-AGENT-01`) and `manual`. No other source is
    claimed.
  - `resolveWithAgent()` is the DS-22 resolver step: it uses the agent when a
    source has a token and reports `agent API: no token` otherwise.
- `packages/rekordbox-live/src/agent-api.test.ts`: tests against a local fake
  agent over real HTTP on an ephemeral port (no token, wrong token, known and
  unknown content ids, closed port), plus the redaction, source enumeration and
  resolver-step checks.

Boundaries: wiring the client into the identity resolver chain (DS-22) and the
Setup panel readout belongs to the main-process work; this slice provides the
client and the resolver step it calls. No token source is asserted to exist
beyond the three enumerated ones until `HW-RB-AGENT-01` records evidence.

## Proof

Observed with `node --experimental-strip-types` against the real module and a
local fake agent:

- `probe()` against the fake agent: present, HTTP 404, no token needed.
- `resolveContent("1234")` without a token: `no-token`; after
  `adoptToken("test-token", "manual")`: `resolved` with
  `/music/track.mp3` and endpoint `/api/data/1234`; unknown id: `not-found`;
  wrong token: `denied`; closed port: `not-present`.
- `describeForLog()` and `redactAgentSecrets` never contain the token
  (`Authorization: Bearer [redacted]`).
- `resolveWithAgent` with no available source reports
  `agent API: no token (...)`, and with a source reports `agent-api` plus the
  endpoint used.
- Scoped type check of the package: 0 diagnostics.

## Delete test

Delete the `Authorization` header in `RekordboxAgentClient.get` and the denied
and resolved tests go red (every resolve comes back `denied` or `not-found`).
Delete the `this.token === null` check in `resolveContent` and the "agent API:
no token" tests go red because a token-less client would call the agent anyway.
