import { describe, expect, it } from "vitest";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { loadConfig } from "../src/config.js";
import { CombinedTokenVerifier, SingleUserOAuthProvider } from "../src/oauth/provider.js";

const config = loadConfig({
  META_PAGE_ACCESS_TOKEN: "A".repeat(40),
  META_PAGE_ID: "123",
  TRANSPORT: "http",
  PUBLIC_URL: "https://mcp.example.com",
  OAUTH_OWNER_PASSWORD: "the-owner-password-123",
} as NodeJS.ProcessEnv);

const testClient: OAuthClientInformationFull = {
  client_id: "claude-client-1",
  client_id_issued_at: Math.floor(Date.now() / 1000),
  redirect_uris: ["https://claude.ai/api/mcp/callback"],
  token_endpoint_auth_method: "none",
};

function makeRedirectCapture() {
  const calls: { status: number; location: string }[] = [];
  const res = {
    redirect: (status: number, location: string) => calls.push({ status, location }),
  } as unknown as import("express").Response;
  return { res, calls };
}

describe("SingleUserOAuthProvider.clientsStore", () => {
  it("round-trips a registered client", () => {
    const provider = new SingleUserOAuthProvider(config);
    provider.clientsStore.registerClient!(testClient);
    expect(provider.clientsStore.getClient(testClient.client_id)).toEqual(testClient);
  });

  it("returns undefined for an unknown client", () => {
    const provider = new SingleUserOAuthProvider(config);
    expect(provider.clientsStore.getClient("does-not-exist")).toBeUndefined();
  });
});

describe("SingleUserOAuthProvider.authorize", () => {
  it("redirects to the local login screen instead of completing the OAuth redirect itself", async () => {
    const provider = new SingleUserOAuthProvider(config);
    const { res, calls } = makeRedirectCapture();

    await provider.authorize(
      testClient,
      { codeChallenge: "challenge-abc", redirectUri: testClient.redirect_uris[0]!, state: "xyz" },
      res,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.status).toBe(302);
    expect(calls[0]!.location).toMatch(/^\/oauth\/login\?login_id=/);
  });

  it("defaults to the mcp scope when the client requested no scopes", async () => {
    const provider = new SingleUserOAuthProvider(config);
    const { res, calls } = makeRedirectCapture();
    await provider.authorize(
      testClient,
      { codeChallenge: "c", redirectUri: testClient.redirect_uris[0]!, scopes: [] },
      res,
    );
    const loginId = new URL(calls[0]!.location, "http://x").searchParams.get("login_id")!;
    expect(provider.store.peekPendingLogin(loginId)?.params.scopes).toEqual(["mcp"]);
  });
});

describe("SingleUserOAuthProvider full authorization_code flow", () => {
  async function beginLogin(provider: SingleUserOAuthProvider) {
    const { res, calls } = makeRedirectCapture();
    await provider.authorize(
      testClient,
      {
        codeChallenge: "fixed-challenge",
        redirectUri: testClient.redirect_uris[0]!,
        state: "state-1",
      },
      res,
    );
    const loginId = new URL(calls[0]!.location, "http://x").searchParams.get("login_id")!;
    return loginId;
  }

  it("issues a working code once the pending login is completed, exchangeable exactly once", async () => {
    const provider = new SingleUserOAuthProvider(config);
    const loginId = await beginLogin(provider);
    const pending = provider.store.consumePendingLogin(loginId)!;

    const code = provider.store.createAuthorizationCode({
      clientId: pending.client.client_id,
      codeChallenge: pending.params.codeChallenge,
      redirectUri: pending.params.redirectUri,
      scopes: pending.params.scopes!,
    });

    expect(await provider.challengeForAuthorizationCode(testClient, code)).toBe("fixed-challenge");

    const tokens = await provider.exchangeAuthorizationCode(
      testClient,
      code,
      undefined,
      testClient.redirect_uris[0],
    );
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.token_type).toBe("bearer");
    expect(tokens.scope).toBe("mcp");

    // The code is single-use: a second exchange must fail.
    await expect(
      provider.exchangeAuthorizationCode(testClient, code, undefined, testClient.redirect_uris[0]),
    ).rejects.toThrow();
  });

  it("rejects exchanging a code issued to a different client", async () => {
    const provider = new SingleUserOAuthProvider(config);
    const code = provider.store.createAuthorizationCode({
      clientId: "some-other-client",
      codeChallenge: "c",
      redirectUri: testClient.redirect_uris[0]!,
      scopes: ["mcp"],
    });
    await expect(provider.exchangeAuthorizationCode(testClient, code)).rejects.toThrow();
  });

  it("rejects an unknown or expired authorization code", async () => {
    const provider = new SingleUserOAuthProvider(config);
    await expect(provider.exchangeAuthorizationCode(testClient, "never-issued")).rejects.toThrow();
    await expect(
      provider.challengeForAuthorizationCode(testClient, "never-issued"),
    ).rejects.toThrow();
  });

  it("rejects a redirect_uri that doesn't match the one used to obtain the code", async () => {
    const provider = new SingleUserOAuthProvider(config);
    const code = provider.store.createAuthorizationCode({
      clientId: testClient.client_id,
      codeChallenge: "c",
      redirectUri: testClient.redirect_uris[0]!,
      scopes: ["mcp"],
    });
    await expect(
      provider.exchangeAuthorizationCode(
        testClient,
        code,
        undefined,
        "https://attacker.example.com/callback",
      ),
    ).rejects.toThrow();
  });

  it("rejects a resource that doesn't match this server's MCP endpoint", async () => {
    const provider = new SingleUserOAuthProvider(config);
    const code = provider.store.createAuthorizationCode({
      clientId: testClient.client_id,
      codeChallenge: "c",
      redirectUri: testClient.redirect_uris[0]!,
      scopes: ["mcp"],
    });
    await expect(
      provider.exchangeAuthorizationCode(
        testClient,
        code,
        undefined,
        testClient.redirect_uris[0],
        new URL("https://a-different-resource-server.example.com/mcp"),
      ),
    ).rejects.toThrow(/only issues tokens for/);
  });
});

describe("SingleUserOAuthProvider refresh tokens", () => {
  it("rotates the refresh token and invalidates the old one", async () => {
    const provider = new SingleUserOAuthProvider(config);
    const first = provider.store.issueRefreshToken(testClient.client_id, ["mcp"]);

    const tokens = await provider.exchangeRefreshToken(testClient, first);
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.refresh_token).not.toBe(first);

    // The old refresh token was single-use and is now gone.
    await expect(provider.exchangeRefreshToken(testClient, first)).rejects.toThrow();
  });

  it("rejects a refresh token issued to a different client", async () => {
    const provider = new SingleUserOAuthProvider(config);
    const token = provider.store.issueRefreshToken("some-other-client", ["mcp"]);
    await expect(provider.exchangeRefreshToken(testClient, token)).rejects.toThrow();
  });
});

describe("SingleUserOAuthProvider.verifyAccessToken", () => {
  it("returns AuthInfo for a token this server issued", async () => {
    const provider = new SingleUserOAuthProvider(config);
    const { token } = provider.store.issueAccessToken(testClient.client_id, ["mcp"]);
    const authInfo = await provider.verifyAccessToken(token);
    expect(authInfo.clientId).toBe(testClient.client_id);
    expect(authInfo.scopes).toEqual(["mcp"]);
    expect(typeof authInfo.expiresAt).toBe("number");
  });

  it("throws for an unknown token", async () => {
    const provider = new SingleUserOAuthProvider(config);
    await expect(provider.verifyAccessToken("not-a-real-token")).rejects.toThrow();
  });
});

describe("SingleUserOAuthProvider.verifyOwnerPassword", () => {
  it("accepts the configured password", () => {
    const provider = new SingleUserOAuthProvider(config);
    expect(provider.verifyOwnerPassword("the-owner-password-123")).toBe(true);
  });

  it("rejects an incorrect password", () => {
    const provider = new SingleUserOAuthProvider(config);
    expect(provider.verifyOwnerPassword("wrong-password")).toBe(false);
  });
});

describe("CombinedTokenVerifier", () => {
  it("accepts a valid OAuth-issued token", async () => {
    const provider = new SingleUserOAuthProvider(config);
    const { token } = provider.store.issueAccessToken(testClient.client_id, ["mcp"]);
    const verifier = new CombinedTokenVerifier(provider, undefined);
    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      clientId: testClient.client_id,
    });
  });

  it("falls back to the legacy static token only when one is configured", async () => {
    const provider = new SingleUserOAuthProvider(config);
    const verifier = new CombinedTokenVerifier(provider, "legacy-static-token-value-1234");
    await expect(
      verifier.verifyAccessToken("legacy-static-token-value-1234"),
    ).resolves.toMatchObject({
      clientId: "legacy-static-token",
      scopes: ["mcp"],
    });
  });

  it("rejects the legacy token value when no legacy token is configured", async () => {
    const provider = new SingleUserOAuthProvider(config);
    const verifier = new CombinedTokenVerifier(provider, undefined);
    await expect(verifier.verifyAccessToken("legacy-static-token-value-1234")).rejects.toThrow();
  });

  it("rejects an unknown token even when a legacy token is configured", async () => {
    const provider = new SingleUserOAuthProvider(config);
    const verifier = new CombinedTokenVerifier(provider, "legacy-static-token-value-1234");
    await expect(verifier.verifyAccessToken("some-other-token")).rejects.toThrow();
  });
});
