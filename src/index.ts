#!/usr/bin/env node
import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ConfigValidationError, loadConfig } from "./config.js";
import { registerSecrets } from "./logger.js";
import { logger } from "./logger.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { secretsOf } from "./config.js";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function runStdio(config: ReturnType<typeof loadConfig>): Promise<void> {
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`${SERVER_NAME} v${SERVER_VERSION} running via stdio`);
}

async function runHttp(config: ReturnType<typeof loadConfig>): Promise<void> {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION });
  });

  // Every /mcp request must present the configured bearer token. Config
  // validation already guarantees MCP_SERVER_AUTH_TOKEN is set whenever
  // TRANSPORT=http, so this server can never be reachable unauthenticated.
  app.use("/mcp", (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!presented || !timingSafeEqual(presented, config.mcpServerAuthToken ?? "")) {
      logger.warn("Rejected /mcp request with missing or invalid bearer token");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

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
      `${SERVER_NAME} v${SERVER_VERSION} listening on http://${config.host}:${config.port}/mcp`,
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
