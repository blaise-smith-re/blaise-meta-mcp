# Security

## Threat model

This server holds one credential that matters: a Meta Page Access Token with read access to Blaise's Instagram Professional account and Facebook Page. The goals, in order:

1. That token is never committed to source control.
2. That token never appears in full in logs, error messages, or agent-facing tool output.
3. Nothing this server does can modify, delete, or publish anything on Meta's side, even by accident or a malformed request.
4. If deployed remotely, only Claude (holding the configured bearer secret) can talk to this server at all.

## No credentials in the repository

- `.env` is git-ignored (`.gitignore`); only `.env.example` (no real values) is committed.
- `.gitignore` also excludes `.tokens.json` and any `*.log` output, in case a future debugging session writes either.
- Config is loaded exclusively through `src/config.ts`, which reads `process.env` — there is no code path that reads a token from a file, a constant, or a fallback default. If the environment variable is missing, the server fails to start with a clear message (`ConfigValidationError`) rather than running with an empty/undefined token.
- The App Secret (`META_APP_SECRET`) is only ever used by the local `scripts/authorize.ts` helper (run on your own machine) — the deployed/running server never needs it and never reads it for normal operation.

## Token redaction

`src/logger.ts` wraps every log call with `redact()`, which:

1. Replaces every registered secret (the access token, app secret, and HTTP bearer auth token — registered once at startup from `secretsOf(config)`) with `[REDACTED]`, wherever it appears in a log line — including inside a larger string like a URL or a JSON blob.
2. As a second layer, pattern-matches any other long token-shaped substring (20+ alphanumeric/`-`/`_`/`.` characters) and redacts that too, so a token accidentally embedded in a Graph API error payload we didn't anticipate still doesn't leak. Numeric IDs and ISO timestamps are explicitly excluded from this pattern so logs stay useful.
3. Applies to **every** log level, since stdio transport reserves stdout for the MCP protocol — all logging goes to stderr, and all of it is redacted the same way.

Tool-facing error messages (what Claude actually sees) are built separately in `src/meta/errors.ts` (`GraphApiError.toAgentMessage()`) and `src/tools/shared.ts` (`describeError()`), and are written to never interpolate the raw token or app secret — they describe the _category_ of failure (expired token, missing permission, rate limited, etc.), not the credential itself. This is verified in `tests/metaClient.test.ts` and `tests/redaction.test.ts`.

## Least-privilege permission design

- Every V1 permission requested (see [TOOLS.md](TOOLS.md) and [META_SETUP.md](META_SETUP.md)) is read-only in intent: `instagram_basic`, `instagram_manage_insights`, `instagram_manage_comments`, `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, `business_management`. These are the names for the **Instagram API with Facebook Login for Business** flow this server uses (Instagram account linked to a Page) — Meta separately renamed the equivalent scopes to an `instagram_business_*` prefix (`instagram_business_basic`, etc.) for the _different_, Page-independent **Instagram API with Instagram Login** flow; don't substitute those names here. See [META_SETUP.md](META_SETUP.md#a-note-on-permission-naming) for the reasoning and residual uncertainty. None of these are requested at Advanced Access — this app runs at Standard Access against Blaise's own account, so there's no Meta App Review surface exposed at all in v1.
- No tool constructs a `POST` or `DELETE` request against the Graph API. `MetaGraphClient.request()` (`src/meta/client.ts`) defaults to `GET`; nothing in `src/tools/` passes a different method.
- The centralized client is the _only_ place that builds a Graph API URL or attaches the access token (as an `Authorization: Bearer` header, never as a URL query parameter, so it can't end up in server access logs or browser history). No tool file talks to `fetch` directly.

## Centralized error handling for the failure modes that matter

`src/meta/errors.ts` categorizes every Graph API failure into `token_expired`, `permission_denied`, `rate_limited`, `unsupported_metric`, `not_found`, `invalid_request`, or `unknown`, based on Meta's documented error codes (190 for expired tokens; 4/17/32/613 for rate limiting; 10/200/299 for permission errors). Each category maps to a specific, actionable message — see [TOOLS.md](TOOLS.md#error-handling-uniformly-across-every-tool). This is exercised by `tests/metaClient.test.ts` against mocked Graph API error payloads, so the mapping doesn't need real credentials to verify.

Unsupported metrics are handled specially: `MetaGraphClient.getInsightsWithFallback()` never fails a whole insights call because one candidate metric isn't available for that object — it retries metric-by-metric and reports the difference. See [TOOLS.md](TOOLS.md) for why this matters (Meta's supported-metric sets vary by object type and change over time).

## Claude connector authentication

**This section documents a finding from a pre-authentication production-readiness QC pass, and the architecture change it drove.**

### The research

Claude has two distinct "MCP connector" surfaces, and they support different authentication mechanisms:

1. **claude.ai / Claude Desktop's "Add custom connector" UI** (Settings → Connectors, or an org's Organization Settings → Connectors for Team/Enterprise) — what an individual user like Blaise uses. As of this QC pass, that UI's own field set is: a server URL, and an **Advanced settings** section with only an **OAuth Client ID** and **OAuth Client Secret**. There is no field to paste a static bearer token or API key. This is confirmed by Anthropic's own help articles ([Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [Build custom connectors via remote MCP servers](https://support.claude.com/en/articles/11503834-build-custom-connectors-via-remote-mcp-servers)) and by a public GitHub issue where a request to add a static-bearer-token field was closed as "not planned" ([anthropics/claude-ai-mcp#112](https://github.com/anthropics/claude-ai-mcp/issues/112)).
2. **The Messages API's `mcp_servers` parameter** (for developers calling the Anthropic API directly, documented at [platform.claude.com/docs/en/agents-and-tools/mcp-connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)) — this _does_ accept an arbitrary pre-obtained `authorization_token` (bearer) supplied by the API caller, no OAuth flow required on Anthropic's side. This surface is not what "connect it to Claude" means for Blaise, who uses claude.ai directly rather than building against the API.

**Conclusion: a static bearer token cannot be entered through the UI Blaise will actually use.** The original v1 PR's design (`MCP_SERVER_AUTH_TOKEN` checked via a manual header comparison) would have left Blaise unable to add this server as a custom connector on claude.ai or Claude Desktop at all — there was nowhere in that UI to put the token.

### The fix

This server now implements a minimal, spec-compliant **OAuth 2.1 authorization server**, built on the official MCP TypeScript SDK's own `server/auth/*` module (`mcpAuthRouter`, `requireBearerAuth`, and the `OAuthServerProvider` interface — not a hand-rolled OAuth implementation), so Claude's standard "Add custom connector" flow works without Blaise ever touching a client ID or secret:

- `src/oauth/provider.ts` — `SingleUserOAuthProvider` implements the SDK's `OAuthServerProvider` interface: public-client Dynamic Client Registration (Claude registers itself automatically, no manual client ID/secret entry), PKCE-protected authorization codes, short-lived access tokens (1 hour) with rotating refresh tokens (single-use, 90-day window), and RFC 8707 resource-indicator validation (a token issued for this server's `/mcp` endpoint cannot be replayed against a different resource).
- `src/oauth/loginRouter.ts` — the one screen a human ever sees: a password prompt gated by `OAUTH_OWNER_PASSWORD`, checked in constant time, rate-limited per IP (10 attempts / 15 minutes). There is no username, no user database, no "forgot password" flow — this server has exactly one authorized user by design.
- `src/index.ts` mounts the SDK's `mcpAuthRouter` (which installs `/authorize`, `/token`, `/register`, `/.well-known/oauth-authorization-server`, and `/.well-known/oauth-protected-resource/mcp` — the endpoints Claude discovers and drives automatically) and protects `/mcp` with the SDK's `requireBearerAuth` middleware.
- `MCP_SERVER_AUTH_TOKEN` (a static token) is kept as an **opt-in fallback**, checked in the same constant-time comparison, for clients that let you set a raw `Authorization` header directly instead of doing OAuth — e.g. Claude Desktop's local JSON config file, or the MCP Inspector during development. It is never a substitute for OAuth on the claude.ai/Claude Desktop connector UI, and it's off unless explicitly configured.
- Nothing about this weakens auth to make testing easier: OAuth remains the default and only path for `TRANSPORT=http` with no fallback configured, `OAUTH_OWNER_PASSWORD` is required by config validation exactly like the old `MCP_SERVER_AUTH_TOKEN` requirement was, and every code/token is short-lived and single-use/rotating.

This is orthogonal to and does not touch the Meta OAuth flow in `scripts/authorize.ts` — that script obtains **Meta's** access token (to call the Graph API); the system described here is **this server's own** authorization server (so **Claude** can call **this server**). Do not confuse `OAUTH_OWNER_PASSWORD` with any Meta/Facebook credential.

### Remaining uncertainty and follow-ups

- The in-memory token/code/client store (`src/oauth/store.ts`) means a process restart invalidates all sessions — Claude will transparently re-run the OAuth flow (prompting Blaise for the password again) rather than erroring silently, but frequent restarts on a low-tier host would mean frequent re-prompts. For a production deployment with real usage, swap it for a persistent store (Redis, SQLite) — the `OAuthStore` class's interface would not need to change, only its backing storage.
- `revokeToken()` is intentionally unimplemented (tokens are short-lived and this is single-user); add it if Blaise ever needs to force-invalidate a session immediately (e.g. a lost device).
- This has not been tested end-to-end against a live Claude connector (that requires a real HTTPS deployment and a real claude.ai account action, both out of scope for this QC pass per its instructions not to deploy). The unit tests in `tests/oauth.test.ts` and `tests/loginRouter.test.ts` verify the OAuth flow's logic in isolation (client registration, PKCE code exchange, refresh rotation, resource-mismatch rejection, password gate, rate limiting) but cannot verify Claude's specific client behavior. **First real end-to-end verification should happen against the actual deployment**, per the next-manual-step guidance in the PR.

## Remote (HTTP) transport security

If deployed with `TRANSPORT=http` (see [README.md](../README.md#setup-in-order)):

- Config validation (`src/config.ts`) **refuses to start** unless `PUBLIC_URL` and `OAUTH_OWNER_PASSWORD` are also set — there's no way to run the HTTP transport unauthenticated, and the OAuth authorization server needs a stable issuer URL to advertise.
- Every request to `/mcp` goes through the SDK's `requireBearerAuth` middleware, which accepts either a valid OAuth-issued access token or (only if explicitly configured) the legacy static `MCP_SERVER_AUTH_TOKEN`, both checked in constant time; a missing, invalid, or expired token gets a `401` with a `WWW-Authenticate` header pointing at this server's protected-resource metadata (per the OAuth 2.0 Protected Resource Metadata spec, RFC 9728) so a compliant client can self-discover how to authenticate.
- `/health` is the only fully unauthenticated route, and it returns nothing but a static status string — no account data. The OAuth discovery/registration endpoints (`/.well-known/*`, `/register`) are intentionally public too, per spec — they carry no secrets, only metadata about how to authenticate.
- Each `/mcp` request gets a fresh `McpServer` + `StreamableHTTPServerTransport` (stateless mode), which avoids request-ID collisions across concurrent calls and means there's no server-side session state that could leak between callers.
- You are responsible for running this behind HTTPS (via your host's load balancer/proxy, e.g. Render/Fly/Railway's built-in TLS) — this server itself speaks plain HTTP, matching how the guide's reference deployment targets expect TLS termination in front of them. `PUBLIC_URL` must be the HTTPS URL your host terminates TLS at; the OAuth router refuses a non-HTTPS issuer URL unless the host is `localhost`/`127.0.0.1`.

## MCP protocol version and SDK choice

This server uses `@modelcontextprotocol/sdk` v1.30.0 (the latest v1.x release, published 2026-07-27) rather than the newer `@modelcontextprotocol/server`/`@modelcontextprotocol/client` v2 packages (GA as `2.0.0` on 2026-07-27, alongside the [2026-07-28 MCP specification](https://blog.modelcontextprotocol.io/posts/2026-07-28/)). This was a deliberate, evidence-based decision, not inertia:

- **Claude's own documented MCP client behavior currently targets the older protocol era, not 2026-07-28.** Anthropic's Messages API MCP connector docs reference the `mcp-client-2025-11-20` beta header and link to the `2025-11-25` authorization spec (`https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization`) as of this QC pass — there is no evidence Claude's connector negotiates or requires 2026-07-28 today. The v1 SDK's `LATEST_PROTOCOL_VERSION` is `2025-11-25`, which matches.
- **v1's `server/auth/*` module already provides everything Claude's documented OAuth flow needs**: PKCE-protected authorization codes, Dynamic Client Registration, bearer-token verification middleware. This is what `src/oauth/` is built on. The 2026-07-28 spec's authorization hardening (RFC 9207 issuer validation, Client ID Metadata Documents replacing DCR) is real, but nothing in Claude's current documented behavior requires it yet.
- **Production stability**: v1.x is a mature, multi-year line; v2.0.0 GA'd one month before this QC pass. Migrating a single-user private server onto a one-month-old major rewrite (different package names, different server construction API, different HTTP handler pattern) for zero currently-observable compatibility benefit would be churn, not hardening.
- **Maintenance burden**: v2 is a genuine rewrite (`McpServer`/`registerTool`/`StreamableHTTPServerTransport` all change shape), not a drop-in upgrade — see the SDK's own [2026-07-28 migration guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28). The SDK maintainers commit to supporting v1.x with bug fixes and security updates for at least 6 months after v2's GA, so staying on v1 today does not mean staying on an abandoned line.

**Decision: stay on SDK v1 (`@modelcontextprotocol/sdk` ^1.30.0) for this v1 foundation.** Revisit if either becomes true: Anthropic's own docs start referencing `2026-07-28` for the connector Blaise actually uses, or a specific 2026-07-28-only capability becomes something this server needs. Re-check both before deciding, rather than assuming either has changed.

## The future write layer: architected, not enabled

The task this server exists for explicitly rules out write actions in v1: publishing, comment replies, message replies, and any Instagram follow/unfollow automation. Rather than leave the door open by omission, the codebase makes "off" an explicit, tested, multi-layer state:

1. **Not registered.** `src/tools/write/index.ts` defines the shape of future write tools (`instagram_publish_media`, `instagram_publish_carousel`, `instagram_publish_reel`, `facebook_publish_post`, `instagram_reply_to_comment`, `facebook_reply_to_comment`, `reply_to_inbound_message`) but `registerFutureWriteTools()` is **never called** from `src/tools/index.ts` — Claude cannot see or call these tools no matter what any environment variable says, until a future code change wires the import back in.
2. **Config-gated, two layers deep.** Even once wired in, every write tool must pass `assertWriteActionAllowed()` (`src/meta/writeGuard.ts`), which requires _both_ the master switch `ENABLE_WRITE_ACTIONS=true` **and** the specific action's own flag (`ALLOW_INSTAGRAM_PUBLISH`, `ALLOW_FACEBOOK_PUBLISH`, `ALLOW_COMMENT_REPLIES`, `ALLOW_MESSAGE_REPLIES`) to be true. Both default to `false`. Enabling publishing doesn't also enable message replies, etc. — each capability is opt-in independently.
3. **No implementation to fall back on.** Even if both flags were somehow set today, every stub handler returns "not implemented" rather than attempting a real Graph API write — there is no publish/reply/message code path in this version at all, so there's nothing to accidentally trigger.
4. **Tested.** `tests/writeGuard.test.ts` verifies all of the above: disabled by default, requires both flags, and per-action flags don't cross-enable each other.

When a future version implements real write actions, it should additionally require: `instagram_content_publish` and/or `pages_manage_posts` permissions (which **do** require Meta App Review + Advanced Access, since publishing is a higher-risk capability class than reading), explicit human confirmation before any publish/reply/message actually fires, and its own security review — this document should be revisited at that point.

## Things this server will never do (out of scope, not just disabled)

- Automated follows/unfollows.
- Scraping Instagram's website or any browser automation — every data access goes through the official Graph API.
- Mass/bulk DMs.
- Fake engagement of any kind.
- Calling undocumented or private Meta endpoints.
- Retrying around a rate limit or otherwise working to bypass a Meta control.

## Token expiry

Page Access Tokens obtained via the flow in [META_SETUP.md](META_SETUP.md) last ~60 days. This server does not store the App Secret or auto-refresh the token — that would mean a running, potentially remote, process holding the one credential capable of minting new tokens, which is a materially larger blast radius than a read-only Page token that simply expires on its own. Refreshing is a deliberate, occasional, local action (`npm run token:authorize`), not something left running unattended.
