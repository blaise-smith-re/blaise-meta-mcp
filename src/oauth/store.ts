import { randomUUID, randomBytes } from "node:crypto";
import type { AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * In-memory storage for this server's single-user OAuth 2.1 authorization
 * server (see src/oauth/provider.ts for why this server implements OAuth at
 * all, and docs/SECURITY.md for the tradeoffs of an in-memory store).
 *
 * Everything here is ephemeral by design for v1: a process restart forces
 * Claude to re-authorize, which is an acceptable cost for a private
 * single-user server and avoids standing up a database for a handful of
 * short-lived records. All entries carry an expiry and are swept lazily on
 * access plus periodically, so nothing here grows unbounded.
 */

const PENDING_LOGIN_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete the password prompt
const AUTH_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes, single use
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days, rotated on every use

export interface PendingLogin {
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
  expiresAt: number;
}

export interface IssuedCode {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  resource?: string;
  expiresAt: number;
}

export interface AccessTokenRecord {
  clientId: string;
  scopes: string[];
  resource?: string;
  expiresAtSeconds: number;
}

export interface RefreshTokenRecord {
  clientId: string;
  scopes: string[];
  resource?: string;
  expiresAt: number;
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export class OAuthStore {
  private readonly clients = new Map<string, OAuthClientInformationFull>();
  private readonly pendingLogins = new Map<string, PendingLogin>();
  private readonly codes = new Map<string, IssuedCode>();
  private readonly accessTokens = new Map<string, AccessTokenRecord>();
  private readonly refreshTokens = new Map<string, RefreshTokenRecord>();

  // --- Clients ---

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.clients.get(clientId);
  }

  registerClient(client: OAuthClientInformationFull): OAuthClientInformationFull {
    this.clients.set(client.client_id, client);
    return client;
  }

  // --- Pending logins (between /authorize and the password form) ---

  createPendingLogin(client: OAuthClientInformationFull, params: AuthorizationParams): string {
    this.sweep();
    const loginId = randomUUID();
    this.pendingLogins.set(loginId, {
      client,
      params,
      expiresAt: Date.now() + PENDING_LOGIN_TTL_MS,
    });
    return loginId;
  }

  peekPendingLogin(loginId: string): PendingLogin | undefined {
    const entry = this.pendingLogins.get(loginId);
    if (!entry || entry.expiresAt < Date.now()) return undefined;
    return entry;
  }

  consumePendingLogin(loginId: string): PendingLogin | undefined {
    const entry = this.peekPendingLogin(loginId);
    this.pendingLogins.delete(loginId);
    return entry;
  }

  // --- Authorization codes ---

  createAuthorizationCode(entry: Omit<IssuedCode, "expiresAt">): string {
    const code = generateToken();
    this.codes.set(code, { ...entry, expiresAt: Date.now() + AUTH_CODE_TTL_MS });
    return code;
  }

  peekAuthorizationCode(code: string): IssuedCode | undefined {
    const entry = this.codes.get(code);
    if (!entry || entry.expiresAt < Date.now()) return undefined;
    return entry;
  }

  consumeAuthorizationCode(code: string): IssuedCode | undefined {
    const entry = this.peekAuthorizationCode(code);
    this.codes.delete(code); // one-time use, regardless of outcome
    return entry;
  }

  // --- Access tokens ---

  issueAccessToken(
    clientId: string,
    scopes: string[],
    resource?: string,
  ): { token: string; expiresAtSeconds: number } {
    const token = generateToken();
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS;
    this.accessTokens.set(token, { clientId, scopes, resource, expiresAtSeconds });
    return { token, expiresAtSeconds };
  }

  getAccessToken(token: string): AccessTokenRecord | undefined {
    const entry = this.accessTokens.get(token);
    if (!entry) return undefined;
    if (entry.expiresAtSeconds < Date.now() / 1000) {
      this.accessTokens.delete(token);
      return undefined;
    }
    return entry;
  }

  // --- Refresh tokens (rotated on every use) ---

  issueRefreshToken(clientId: string, scopes: string[], resource?: string): string {
    const token = generateToken();
    this.refreshTokens.set(token, {
      clientId,
      scopes,
      resource,
      expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
    });
    return token;
  }

  consumeRefreshToken(token: string): RefreshTokenRecord | undefined {
    const entry = this.refreshTokens.get(token);
    this.refreshTokens.delete(token); // always rotate — old refresh token is single-use
    if (!entry || entry.expiresAt < Date.now()) return undefined;
    return entry;
  }

  /** Drops expired entries. Called opportunistically; also safe to call on a timer. */
  sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.pendingLogins)
      if (entry.expiresAt < now) this.pendingLogins.delete(id);
    for (const [code, entry] of this.codes) if (entry.expiresAt < now) this.codes.delete(code);
    for (const [token, entry] of this.accessTokens)
      if (entry.expiresAtSeconds < now / 1000) this.accessTokens.delete(token);
    for (const [token, entry] of this.refreshTokens)
      if (entry.expiresAt < now) this.refreshTokens.delete(token);
  }
}
