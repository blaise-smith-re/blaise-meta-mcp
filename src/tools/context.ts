import type { AppConfig } from "../config.js";
import type { MetaGraphClient } from "../meta/client.js";

/** Bundles everything a tool handler needs, threaded through at registration time. */
export interface ToolContext {
  client: MetaGraphClient;
  config: AppConfig;
}
