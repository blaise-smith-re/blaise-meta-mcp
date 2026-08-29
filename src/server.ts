import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "./config.js";
import { MetaGraphClient } from "./meta/client.js";
import { registerAllTools } from "./tools/index.js";

export const SERVER_NAME = "blaise-meta-mcp-server";
export const SERVER_VERSION = "0.1.0";

/** Builds a fresh McpServer instance with every V1 tool registered. */
export function createServer(config: AppConfig): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const client = new MetaGraphClient(config);

  registerAllTools(server, { client, config });

  return server;
}
