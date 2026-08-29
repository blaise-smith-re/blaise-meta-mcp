#!/usr/bin/env node
import "dotenv/config";
import express, { type Request, type Response } from "express";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { ConfigValidationError, loadConfig } from "./config.js";
import { registerSecrets } from "./logger.js";
import { logger } from "./logger.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { secretsOf } from "./config.js";
import { CombinedTokenVerifier, SingleUserOAuthProvider } from "./oauth/provider.js";
import { createLoginRouter } from "./oauth/loginRouter.js";

async function runStdio(config: ReturnType<typeof loadConfig>): Promise<void> {
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`${SERVER_NAME} v${SERVER_VERSION} running via stdio`);
}

async function runHttp(config: ReturnType<typeof loadConfig>): Promise<void> {
  // Config validation guarantees these are set whenever TRANSPORT=http.
  const publicUrl = config.publicUrl!;
  const resourceServerUrl = new URL("/mcp", publicUrl);

  const oauthProvider = new SingleUserOAuthProvider(config);
  const tokenVerifier = new CombinedTokenVerifier(oauthProvider, config.mcpServerAuthToken);

  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION });
  });

  // Installs /authorize, /token, /register, /.well-known/oauth-authorization-server,
  // and /.well-known/oauth-protected-resource/mcp — the endpoints Claude's
  // "Add custom connector" flow discovers and drives automatically. See
  // docs/SECURITY.md#claude-connector-authentication for why this server
  // implements OAuth at all rather than a simpler static token.
  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: new URL(publicUrl),
      resourceServerUrl,
      resourceName: "Blaise Meta MCP",
      scopesSupported: ["mcp"],
    }),
  );

  // The password-prompt screen OAuthServerProvider.authorize() redirects to.
  app.use(createLoginRouter(oauthProvider));

  // Every /mcp request must present a valid Bearer token: either one issued
  // by the OAuth flow above, or (only if explicitly configured) the legacy
  // static MCP_SERVER_AUTH_TOKEN for non-OAuth clients. Config validation
  // guarantees OAUTH_OWNER_PASSWORD is set whenever TRANSPORT=http, so this
  // server can never be reachable unauthenticated.
  app.use(
    "/mcp",
    requireBearerAuth({
      verifier: tokenVerifier,
      requiredScopes: ["mcp"],
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceServerUrl),
    }),
  );

  app.post("/mcp", async (req: Request, res: Response) => {
    // A fresh server + transport per request keeps this stateless and
    // avoids request-ID collisions across concurrent calls from Claude.
    const server = createServer(config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.listen(config.port, config.host, () => {
    logger.info(
      `${SERVER_NAME} v${SERVER_VERSION} listening on ${config.host}:${config.port} — public MCP endpoint: ${resourceServerUrl.href}`,
    );
  });
}

async function main(): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      // Config errors go to stderr and exit before anything (including a
      // stdio transport) starts, so a misconfigured server never boots.
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  registerSecrets(secretsOf(config));
  logger.setLevel(config.logLevel);

  if (config.transport === "http") {
    await runHttp(config);
  } else {
    await runStdio(config);
  }
}

main().catch((error) => {
  logger.error("Fatal error starting server", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
