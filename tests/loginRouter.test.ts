import { createServer, type Server } from "node:http";
import { request as httpRequest } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { loadConfig } from "../src/config.js";
import { SingleUserOAuthProvider } from "../src/oauth/provider.js";
import { createLoginRouter } from "../src/oauth/loginRouter.js";

const config = loadConfig({
  META_IG_ACCESS_TOKEN: "A".repeat(40),
  META_IG_USER_ID: "123",
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

interface SimpleResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function post(port: number, path: string, form: Record<string, string>): Promise<SimpleResponse> {
  const body = new URLSearchParams(form).toString();
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }),
        );
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function get(port: number, path: string): Promise<SimpleResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

describe("login router", () => {
  let server: Server;
  let port: number;
  let provider: SingleUserOAuthProvider;

  beforeEach(async () => {
    provider = new SingleUserOAuthProvider(config);
    const app = express();
    app.use(createLoginRouter(provider));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function startLogin() {
    const captured: { location?: string } = {};
    await provider.authorize(
      testClient,
      { codeChallenge: "chal", redirectUri: testClient.redirect_uris[0]!, state: "s1" },
      {
        redirect: (_status: number, location: string) => (captured.location = location),
      } as unknown as import("express").Response,
    );
    const loginId = new URL(captured.location!, "http://x").searchParams.get("login_id")!;
    return loginId;
  }

  it("GET renders the password form for a valid pending login", async () => {
    const loginId = await startLogin();
    const res = await get(port, `/oauth/login?login_id=${loginId}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('name="login_id"');
    expect(res.body).toContain(loginId);
  });

  it("GET rejects an unknown login_id", async () => {
    const res = await get(port, "/oauth/login?login_id=does-not-exist");
    expect(res.status).toBe(400);
  });

  it("POST with the wrong password re-renders the form with an error, without consuming the login", async () => {
    const loginId = await startLogin();
    const res = await post(port, "/oauth/login", { login_id: loginId, password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.body).toContain("Incorrect password");
    // The pending login must still be usable after a wrong attempt.
    expect(provider.store.peekPendingLogin(loginId)).toBeDefined();
  });

  it("POST with the correct password redirects to the client's redirect_uri with a code and state", async () => {
    const loginId = await startLogin();
    const res = await post(port, "/oauth/login", {
      login_id: loginId,
      password: "the-owner-password-123",
    });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location as string);
    expect(location.origin + location.pathname).toBe(testClient.redirect_uris[0]);
    expect(location.searchParams.get("code")).toBeTruthy();
    expect(location.searchParams.get("state")).toBe("s1");

    // The code is now redeemable via the standard provider flow.
    const code = location.searchParams.get("code")!;
    expect(await provider.challengeForAuthorizationCode(testClient, code)).toBe("chal");
  });

  it("POST consumes the pending login so it cannot be replayed", async () => {
    const loginId = await startLogin();
    await post(port, "/oauth/login", { login_id: loginId, password: "the-owner-password-123" });
    const replay = await post(port, "/oauth/login", {
      login_id: loginId,
      password: "the-owner-password-123",
    });
    expect(replay.status).toBe(400);
  });

  it("rate-limits repeated failed login attempts from the same client", async () => {
    const loginId = await startLogin();
    let lastStatus = 0;
    for (let i = 0; i < 12; i++) {
      const res = await post(port, "/oauth/login", { login_id: loginId, password: "wrong" });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
