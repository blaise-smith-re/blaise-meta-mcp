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

/**
 * Registers every V1 (read-only) tool this server exposes.
 *
 * The three facebook_* tools are the optional Facebook Page module: Blaise
 * currently has a personal Facebook profile in Professional Mode, not a
 * separate Facebook Page, and Meta's Graph API has no supported way to read
 * a Professional-Mode profile's posts/insights (Page-level access has been
 * Page-only since 2018 — see docs/META_SETUP.md#facebook-professional-mode).
 * These tools stay in the codebase, fully implemented, but are only
 * registered — and therefore only visible to Claude — when
 * ENABLE_FACEBOOK_PAGE_MODULE=true, which also requires META_PAGE_ACCESS_TOKEN
 * and META_PAGE_ID to be set (config.ts). Instagram functionality never
 * depends on this module.
 */
export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  registerMetaGetAccount(server, ctx);
  registerInstagramGetProfile(server, ctx);
  registerInstagramListMedia(server, ctx);
  registerInstagramGetMediaInsights(server, ctx);
  registerInstagramGetAccountInsights(server, ctx);
  registerInstagramListComments(server, ctx);
  registerInstagramGetMentions(server, ctx);

  if (ctx.config.facebookPage.enabled) {
    registerFacebookGetPage(server, ctx);
    registerFacebookListPosts(server, ctx);
    registerFacebookGetPostInsights(server, ctx);
  }
}
