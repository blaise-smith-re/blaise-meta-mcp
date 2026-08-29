import express, { type Request, type Response } from "express";
import type { SingleUserOAuthProvider } from "./provider.js";

const MAX_LOGIN_ATTEMPTS_PER_WINDOW = 10;
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** Tiny per-IP rate limiter for the login POST, independent of the SDK's own /authorize limiter. */
class LoginRateLimiter {
  private readonly attempts = new Map<string, { count: number; windowStart: number }>();

  check(key: string): boolean {
    const now = Date.now();
    const entry = this.attempts.get(key);
    if (!entry || now - entry.windowStart > LOGIN_RATE_LIMIT_WINDOW_MS) {
      this.attempts.set(key, { count: 1, windowStart: now });
      return true;
    }
    entry.count += 1;
    return entry.count <= MAX_LOGIN_ATTEMPTS_PER_WINDOW;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderLoginPage(options: {
  loginId: string;
  clientName?: string;
  error?: string;
}): string {
  const appName = options.clientName ? escapeHtml(options.clientName) : "This application";
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Sign in — Blaise Meta MCP</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 420px; margin: 4rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.25rem; }
  p { color: #555; }
  input[type="password"] { width: 100%; padding: 0.6rem; font-size: 1rem; box-sizing: border-box; margin: 0.5rem 0 1rem; }
  button { width: 100%; padding: 0.6rem; font-size: 1rem; cursor: pointer; }
  .error { color: #b00020; margin-bottom: 1rem; }
</style>
</head>
<body>
  <h1>Blaise Meta MCP</h1>
  <p>${appName} is requesting access to this private server. Enter the owner password to continue.</p>
  ${options.error ? `<p class="error">${escapeHtml(options.error)}</p>` : ""}
  <form method="POST" action="/oauth/login">
    <input type="hidden" name="login_id" value="${escapeHtml(options.loginId)}">
    <input type="password" name="password" placeholder="Owner password" autofocus required>
    <button type="submit">Continue</button>
  </form>
</body>
</html>`;
}

/**
 * Standalone router for the password-prompt login screen. Mounted directly
 * on the app (not inside mcpAuthRouter, which only owns the standard OAuth
 * endpoints) because the OAuthServerProvider.authorize() contract doesn't
 * give the provider access to the raw request body needed for a login form
 * — the standard pattern is for authorize() to redirect here, and for this
 * route to complete the OAuth redirect back to the client once the
 * password checks out.
 */
export function createLoginRouter(provider: SingleUserOAuthProvider): express.Router {
  const router = express.Router();
  const rateLimiter = new LoginRateLimiter();

  router.get(
    "/oauth/login",
    express.urlencoded({ extended: false }),
    (req: Request, res: Response) => {
      const loginId = String(req.query.login_id ?? "");
      const pending = provider.store.peekPendingLogin(loginId);
      if (!pending) {
        res
          .status(400)
          .send(
            "This login link has expired or is invalid. Return to Claude and try connecting again.",
          );
        return;
      }
      res
        .status(200)
        .type("html")
        .send(renderLoginPage({ loginId, clientName: pending.client.client_name }));
    },
  );

  router.post(
    "/oauth/login",
    express.urlencoded({ extended: false }),
    (req: Request, res: Response) => {
      const loginId = String(req.body.login_id ?? "");
      const password = String(req.body.password ?? "");

      const clientIp = req.ip ?? "unknown";
      if (!rateLimiter.check(clientIp)) {
        res.status(429).send("Too many login attempts. Wait 15 minutes and try again.");
        return;
      }

      const pending = provider.store.peekPendingLogin(loginId);
      if (!pending) {
        res
          .status(400)
          .send(
            "This login link has expired or is invalid. Return to Claude and try connecting again.",
          );
        return;
      }

      if (!provider.verifyOwnerPassword(password)) {
        res
          .status(401)
          .type("html")
          .send(
            renderLoginPage({
              loginId,
              clientName: pending.client.client_name,
              error: "Incorrect password.",
            }),
          );
        return;
      }

      provider.store.consumePendingLogin(loginId);
      const code = provider.store.createAuthorizationCode({
        clientId: pending.client.client_id,
        codeChallenge: pending.params.codeChallenge,
        redirectUri: pending.params.redirectUri,
        scopes: pending.params.scopes ?? [],
        resource: pending.params.resource?.href,
      });

      const redirectUrl = new URL(pending.params.redirectUri);
      redirectUrl.searchParams.set("code", code);
      if (pending.params.state) redirectUrl.searchParams.set("state", pending.params.state);
      res.redirect(302, redirectUrl.href);
    },
  );

  return router;
}
