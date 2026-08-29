# Blaise Meta MCP

A private remote [MCP](https://modelcontextprotocol.io) server that lets Claude securely read data from **Blaise Smith's Instagram Professional account** (Buy Sell Home Team | RE/MAX Results) — through Meta's official Graph API only. Blaise's Instagram account is linked to his personal Facebook profile (Professional Mode), not a separate Facebook Page, so this server authenticates through "Instagram API with Instagram Login" — no Facebook Page is required. (A Facebook Page tools module exists but is disabled by default; see below.)

This is v1: **read-only**. Claude can look up profile info, recent posts/Reels, comments, and performance insights. It cannot post, publish, delete, or message anyone. See [docs/SECURITY.md](docs/SECURITY.md) for why, and what a future write-enabled version would require.

You do not need to know how to code to set this up — follow the steps below in order. Budget about 30–45 minutes the first time.

## What this actually does

Claude talks to this server using the Model Context Protocol. This server talks to Meta's Graph API using a token you generate once. Nothing runs "automatically" — every tool call happens because Claude, on your behalf, asked a specific question (e.g. "what are my last 5 Instagram posts?").

```
Claude  <--MCP-->  this server  <--Graph API-->  Meta (Instagram)
```

## What you get in v1

| Tool                             | What it does                                            |
| -------------------------------- | ------------------------------------------------------- |
| `meta_get_account`               | Identify the connected Instagram account                |
| `instagram_get_profile`          | Instagram profile info and follower/media counts        |
| `instagram_list_media`           | Recent Instagram posts, Reels, carousels                |
| `instagram_get_media_insights`   | Reach, views, saves, shares, etc. for one post          |
| `instagram_get_account_insights` | Account-level reach, profile activity, engaged accounts |
| `instagram_list_comments`        | Comments on a specific Instagram post                   |
| `instagram_get_mentions`         | Instagram tags, and specific @mention lookups           |

Plus an **optional, disabled-by-default Facebook Page module** (`facebook_get_page`, `facebook_list_posts`, `facebook_get_post_insights`) for if Blaise ever creates and connects an actual Facebook Page — see [docs/META_SETUP.md#facebook-professional-mode](docs/META_SETUP.md#facebook-professional-mode) for why it's off by default (Meta's API doesn't support reading a Professional-Mode personal profile the way it supports a Page).

Full detail on inputs/outputs/permissions for each: [docs/TOOLS.md](docs/TOOLS.md).

## Setup, in order

1. **Create and configure the Meta app.** Follow [docs/META_SETUP.md](docs/META_SETUP.md) end to end — it's a screen-by-screen walkthrough for someone who has never used the Meta Developer Dashboard. You'll end up with an App ID, an App Secret, and (via the helper script below) a long-lived Instagram User Access Token. No Facebook Page is needed.
2. **Install Node.js.** Get the LTS version from [nodejs.org](https://nodejs.org) if you don't already have it (version 20 or newer).
3. **Install this project's dependencies.** In a terminal, from this folder:
   ```
   npm install
   ```
4. **Create your `.env` file.**
   ```
   cp .env.example .env
   ```
   Open `.env` in any text editor. You'll fill in the values from step 1.
5. **Generate your access token.** Once you have `META_APP_ID` and `META_APP_SECRET` in `.env`:
   ```
   npm run token:authorize
   ```
   This opens a one-time authorization flow (instructions print in the terminal) and prints the `META_IG_ACCESS_TOKEN` and `META_IG_USER_ID` values to paste into `.env`. Full detail in [docs/META_SETUP.md](docs/META_SETUP.md#getting-your-access-token).
6. **Verify it works locally.**
   ```
   npm run build
   npm start
   ```
   You should see `blaise-meta-mcp-server v0.1.0 running via stdio` with no errors. Press Ctrl+C to stop it.
7. **Connect it to Claude.**
   - **Local use (Claude Desktop / Claude Code):** point it at `TRANSPORT=stdio` (the default) and add this server to your MCP client config, running `node dist/index.js` from this folder with the `.env` values loaded.
   - **Remote use (Claude's "Add custom connector" on claude.ai or Claude Desktop):** deploy this project to a Node.js host (Render, Fly.io, Railway, a small VPS — anywhere that can run a long-lived Node process, terminate HTTPS, and hold environment variables as secrets, never in code). Set `TRANSPORT=http`, `PUBLIC_URL` to that host's HTTPS URL, and `OAUTH_OWNER_PASSWORD` to a long random passphrase (`node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`) — see `.env.example`. Then in Claude's connector settings, click **Add custom connector**, paste `https://your-domain/mcp` as the server URL, and click through — Claude discovers this server's built-in OAuth automatically and will redirect you to a password prompt (that's `OAUTH_OWNER_PASSWORD`) the first time. **Why OAuth and not a simple pasted token**: Claude's own "Add custom connector" screen for individual accounts only has fields for a server URL and (optionally) OAuth client credentials — there is no field to paste in a static API key or bearer token. A remote MCP server has to speak OAuth to be addable there at all. See [docs/SECURITY.md](docs/SECURITY.md#claude-connector-authentication) for the full research this is based on.

## Keeping the token working

The Instagram User Access Token expires roughly every 60 days. Re-run `npm run token:authorize` before it does (Meta will start returning "token expired" errors from any tool once it lapses — see [docs/SECURITY.md](docs/SECURITY.md#token-expiry)). There's nothing to "renew" inside Claude — it's a one-time terminal command on your machine.

## Project layout

```
src/
  index.ts            entry point — picks stdio or HTTP transport
  server.ts            builds the MCP server and registers tools
  config.ts             typed, validated environment configuration
  logger.ts             stderr logger with automatic secret redaction
  security.ts            constant-time comparison helper
  constants.ts           shared constants, candidate insights metrics
  meta/
    client.ts            the one place that calls the Graph API
    errors.ts             typed Graph API error handling
    account.ts             the configured Instagram Business Account ID
    writeGuard.ts           gate for the (disabled) future write layer
  oauth/                  this server's own OAuth 2.1 auth server, for
                          Claude's connector auth (see docs/SECURITY.md)
    store.ts               in-memory clients/codes/tokens store
    provider.ts             implements the MCP SDK's OAuthServerProvider
    loginRouter.ts           the one-password login screen
  tools/                  one file per MCP tool
    write/                 architected-but-disabled future write tools
scripts/
  authorize.ts            one-time local OAuth helper (see step 5 above)
docs/
  META_SETUP.md            Meta Developer Dashboard walkthrough
  TOOLS.md                  every tool's inputs, outputs, and permissions
  SECURITY.md                security model and the disabled write layer
tests/                    vitest unit tests (mocked Graph API, no live credentials needed)
```

## Development

```
npm run dev          # run locally with auto-reload (stdio)
npm run typecheck     # TypeScript, no emit
npm run lint          # ESLint
npm run format        # Prettier, writes changes
npm test              # vitest, all mocked — no real Meta credentials needed
npm run build         # compile to dist/
```
