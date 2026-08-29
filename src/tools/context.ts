import type { AppConfig } from "../config.js";
import type { MetaGraphClient } from "../meta/client.js";

/**
 * Bundles everything a tool handler needs, threaded through at registration
 * time. Two separate Graph API clients because this server talks to two
 * genuinely different Meta surfaces:
 *  - igClient: graph.instagram.com with Blaise's Instagram User Access
 *    Token — always present, used by every Instagram tool.
 *  - fbClient: graph.facebook.com with a Page Access Token — only present
 *    when the optional Facebook Page module is enabled (config.facebookPage.enabled),
 *    since Blaise does not currently have a Facebook Page. See
 *    docs/META_SETUP.md and src/tools/facebookPage.ts.
 */
export interface ToolContext {
  igClient: MetaGraphClient;
  fbClient?: MetaGraphClient;
  config: AppConfig;
}
