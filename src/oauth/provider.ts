import type { Response } from "express";
import type {
  AuthorizationParams,
  OAuthServerProvider,
  OAuthTokenVerifier,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  InvalidGrantError,
  InvalidTargetError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AppConfig } from "../config.js";
import { OAuthStore } from "./store.js";
import { timingSafeEqual } from "../security.js";

const DEFAULT_SCOPE = "mcp";

/**
 * A minimal, spec-compliant OAuth 2.1 authorization server for exactly one
 * user (Blaise). This exists because Claude's standard "Add custom
 * connector" flow (claude.ai / Claude Desktop, individual accounts) only
 * offers OAuth in its UI — there is no field to paste in a static bearer
 * token — so a remote MCP server has to speak OAuth to be addable there at
 * all. See docs/SECURITY.md#claude-connector-authentication for the
 * research this is based on.
 *
 * "Authorization" here is deliberately simple: one password
 * (OAUTH_OWNER_PASSWORD), checked in constant time, gates the one login
 * screen this server has. There is no user database, no multi-tenant
 * concept, and no client-secret-bearing confidential clients — every
 * registered client is a public client using PKCE, which is the correct
 * OAuth 2.1 posture for an MCP client like Claude.
 */
export class SingleUserOAuthProvider implements OAuthServerProvider {
  readonly store = new OAuthStore();
  private readonly resourceServerUrl: string;

  constructor(private readonly config: AppConfig) {
    if (!config.publicUrl) {
      throw new Error("SingleUserOAuthProvider requires config.publicUrl to be set");
    }
    this.resourceServerUrl = new URL("/mcp", config.publicUrl).href;
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (clientId) => this.store.getClient(clientId),
      registerClient: (client) => this.store.registerClient(client as OAuthClientInformationFull),
    };
  }

  /**
   * Per the OAuthServerProvider contract, this must eventually redirect to
   * the client's redirect_uri with either a code or an error. This
   * implementation defers that: it stashes the pending request and sends
   * the browser to this server's own /oauth/login password prompt, which
   * completes the redirect once Blaise authenticates (see
   * src/oauth/loginRouter.ts).
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const normalizedParams: AuthorizationParams = {
      ...params,
      scopes: params.scopes && params.scopes.length > 0 ? params.scopes : [DEFAULT_SCOPE],
    };
    const loginId = this.store.createPendingLogin(client, normalizedParams);
    res.redirect(302, `/oauth/login?login_id=${encodeURIComponent(loginId)}`);
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const entry = this.store.peekAuthorizationCode(authorizationCode);
    if (!entry || entry.clientId !== client.client_id) {
      throw new InvalidGrantError(
        "Authorization code is invalid, expired, or was issued to a different client",
      );
    }
    return entry.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    // The SDK's token handler already verified PKCE (via challengeForAuthorizationCode)
    // before calling this, so _codeVerifier is intentionally unused here.
    const entry = this.store.consumeAuthorizationCode(authorizationCode);
    if (!entry || entry.clientId !== client.client_id) {
      throw new InvalidGrantError("Authorization code is invalid, expired, or was already used");
    }
    if (redirectUri && redirectUri !== entry.redirectUri) {
      throw new InvalidGrantError("redirect_uri does not match the one used to obtain this code");
    }
    this.assertResourceMatches(resource);

    return this.issueTokens(client.client_id, entry.scopes, entry.resource);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const entry = this.store.consumeRefreshToken(refreshToken);
    if (!entry || entry.clientId !== client.client_id) {
      throw new InvalidGrantError("Refresh token is invalid, expired, or was already used");
    }
    this.assertResourceMatches(resource);

    return this.issueTokens(
      client.client_id,
      scopes && scopes.length > 0 ? scopes : entry.scopes,
      entry.resource,
    );
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const entry = this.store.getAccessToken(token);
    if (!entry) {
      throw new InvalidTokenError("Access token is invalid, expired, or has been revoked");
    }
    return {
      token,
      clientId: entry.clientId,
      scopes: entry.scopes,
      expiresAt: entry.expiresAtSeconds,
      resource: entry.resource ? new URL(entry.resource) : undefined,
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    _request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    // Not implemented in v1: tokens are short-lived (1h access / rotated-on-use
    // refresh) and this is a single-user server, so unimplemented revocation
    // is a low-severity gap. Left as a documented follow-up rather than a
    // rushed implementation — see docs/SECURITY.md.
  }

  private assertResourceMatches(resource?: URL): void {
    if (resource && resource.href !== this.resourceServerUrl) {
      throw new InvalidTargetError(
        `This authorization server only issues tokens for ${this.resourceServerUrl}`,
      );
    }
  }

  private issueTokens(clientId: string, scopes: string[], resource?: string): OAuthTokens {
    const { token: access_token, expiresAtSeconds } = this.store.issueAccessToken(
      clientId,
      scopes,
      resource,
    );
    const refresh_token = this.store.issueRefreshToken(clientId, scopes, resource);
    return {
      access_token,
      token_type: "bearer",
      expires_in: expiresAtSeconds - Math.floor(Date.now() / 1000),
      refresh_token,
      scope: scopes.join(" "),
    };
  }

  /** Checks the login form's submitted password against OAUTH_OWNER_PASSWORD in constant time. */
  verifyOwnerPassword(candidate: string): boolean {
    if (!this.config.oauthOwnerPassword) return false;
    return timingSafeEqual(candidate, this.config.oauthOwnerPassword);
  }
}

/**
 * Wraps the OAuth provider's token verification with an optional fallback to
 * a single static legacy bearer token (MCP_SERVER_AUTH_TOKEN), for clients
 * that can't do OAuth at all — e.g. Claude Desktop's local JSON config file
 * (which supports arbitrary custom headers) or the MCP Inspector during
 * development. This fallback is opt-in: it only ever activates if an
 * operator explicitly sets MCP_SERVER_AUTH_TOKEN, and even then it's checked
 * in constant time exactly like the OAuth-issued tokens are. OAuth remains
 * the only path the claude.ai/Claude Desktop "Add custom connector" UI can
 * actually use, per docs/SECURITY.md.
 */
export class CombinedTokenVerifier implements OAuthTokenVerifier {
  constructor(
    private readonly oauthProvider: SingleUserOAuthProvider,
    private readonly legacyStaticToken: string | undefined,
  ) {}

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (this.legacyStaticToken && timingSafeEqual(token, this.legacyStaticToken)) {
      return {
        token,
        clientId: "legacy-static-token",
        scopes: [DEFAULT_SCOPE],
        expiresAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365, // static tokens don't expire; use a far-future value for the middleware's expiry check
      };
    }
    return this.oauthProvider.verifyAccessToken(token);
  }
}
