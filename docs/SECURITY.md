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

- Every V1 permission requested (see [TOOLS.md](TOOLS.md) and [META_SETUP.md](META_SETUP.md)) is read-only in intent: `instagram_basic`, `instagram_manage_insights`, `instagram_manage_comments`, `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, `business_management`. None of these are requested at Advanced Access — this app runs at Standard Access against Blaise's own account, so there's no Meta App Review surface exposed at all in v1.
- No tool constructs a `POST` or `DELETE` request against the Graph API. `MetaGraphClient.request()` (`src/meta/client.ts`) defaults to `GET`; nothing in `src/tools/` passes a different method.
- The centralized client is the _only_ place that builds a Graph API URL or attaches the access token (as an `Authorization: Bearer` header, never as a URL query parameter, so it can't end up in server access logs or browser history). No tool file talks to `fetch` directly.

## Centralized error handling for the failure modes that matter

`src/meta/errors.ts` categorizes every Graph API failure into `token_expired`, `permission_denied`, `rate_limited`, `unsupported_metric`, `not_found`, `invalid_request`, or `unknown`, based on Meta's documented error codes (190 for expired tokens; 4/17/32/613 for rate limiting; 10/200/299 for permission errors). Each category maps to a specific, actionable message — see [TOOLS.md](TOOLS.md#error-handling-uniformly-across-every-tool). This is exercised by `tests/metaClient.test.ts` against mocked Graph API error payloads, so the mapping doesn't need real credentials to verify.

Unsupported metrics are handled specially: `MetaGraphClient.getInsightsWithFallback()` never fails a whole insights call because one candidate metric isn't available for that object — it retries metric-by-metric and reports the difference. See [TOOLS.md](TOOLS.md) for why this matters (Meta's supported-metric sets vary by object type and change over time).

## Remote (HTTP) transport security

If deployed with `TRANSPORT=http` (see [README.md](../README.md#setup-in-order)):

- Config validation (`src/config.ts`) **refuses to start** unless `MCP_SERVER_AUTH_TOKEN` is also set — there's no way to run the HTTP transport unauthenticated.
- Every request to `/mcp` is checked against that bearer token using a constant-time comparison (`timingSafeEqual` in `src/index.ts`) before it reaches the MCP server at all; a missing or wrong token gets a `401` with no further processing.
- `/health` is the only unauthenticated route, and it returns nothing but a static status string — no account data.
- Each `/mcp` request gets a fresh `McpServer` + `StreamableHTTPServerTransport` (stateless mode), which avoids request-ID collisions across concurrent calls and means there's no server-side session state that could leak between callers.
- You are responsible for running this behind HTTPS (via your host's load balancer/proxy, e.g. Render/Fly/Railway's built-in TLS) — this server itself speaks plain HTTP, matching how the guide's reference deployment targets expect TLS termination in front of them.

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
