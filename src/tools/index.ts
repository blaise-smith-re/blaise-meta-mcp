import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./context.js";
import { registerMetaGetAccount } from "./metaGetAccount.js";
import { registerInstagramGetProfile } from "./instagramProfile.js";
import { registerInstagramListMedia } from "./instagramMedia.js";
import { registerInstagramGetMediaInsights } from "./instagramMediaInsights.js";
import { registerInstagramGetAccountInsights } from "./instagramAccountInsights.js";
import { registerInstagramListComments } from "./instagramComments.js";
import { registerInstagramGetMentions } from "./instagramMentions.js";
import { registerFacebookGetPage } from "./facebookPage.js";
import { registerFacebookListPosts } from "./facebookPosts.js";
import { registerFacebookGetPostInsights } from "./facebookPostInsights.js";

// NOTE: the future write layer (src/tools/write/index.ts) is intentionally
// NOT imported or registered here. V1 ships read-only. See docs/SECURITY.md.

/** Registers every V1 (read-only) tool this server exposes. */
export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  registerMetaGetAccount(server, ctx);
  registerInstagramGetProfile(server, ctx);
  registerInstagramListMedia(server, ctx);
  registerInstagramGetMediaInsights(server, ctx);
  registerInstagramGetAccountInsights(server, ctx);
  registerInstagramListComments(server, ctx);
  registerInstagramGetMentions(server, ctx);
  registerFacebookGetPage(server, ctx);
  registerFacebookListPosts(server, ctx);
  registerFacebookGetPostInsights(server, ctx);
}
