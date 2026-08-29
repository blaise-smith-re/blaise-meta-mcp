import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../context.js";
import { textResult, withToolErrorHandling, type ToolResult } from "../shared.js";
import { assertWriteActionAllowed, type WriteActionFlag } from "../../meta/writeGuard.js";

/**
 * FUTURE WRITE LAYER — architected, not implemented, not enabled.
 *
 * These tools exist to show the intended shape of write actions (Instagram
 * publishing, Facebook Page publishing, comment replies, inbound message
 * replies) so a future version can implement them behind the same gate.
 * None of them call the Graph API. Every handler goes straight through
 * assertWriteActionAllowed(), which throws unless BOTH:
 *   1. ENABLE_WRITE_ACTIONS=true, and
 *   2. the tool's specific ALLOW_* flag is also true
 * are set in the environment — both default to false. Even if someone
 * enables both flags today, the handler still returns a clear
 * "not implemented" error rather than attempting a real write, because the
 * actual Graph API publish/reply calls have not been built or reviewed yet.
 *
 * registerFutureWriteTools() is NOT called from src/tools/index.ts. Wire it
 * in only once real implementations, input validation, and review exist for
 * each action — and even then, each stays behind its own flag.
 */

const WriteActionInputSchema = z
  .object({})
  .strict()
  .describe("Write actions are not implemented in v1.");

function futureWriteTool(
  server: McpServer,
  ctx: ToolContext,
  name: string,
  title: string,
  description: string,
  flag: WriteActionFlag,
): void {
  server.registerTool(
    name,
    {
      title,
      description: `${description}\n\nNOT IMPLEMENTED in this v1 read-only release. Architected for a future version; gated behind ENABLE_WRITE_ACTIONS and a per-action ALLOW_* flag, both off by default. See docs/SECURITY.md.`,
      inputSchema: WriteActionInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    withToolErrorHandling(async (): Promise<ToolResult> => {
      assertWriteActionAllowed(ctx.config, name, flag);
      // Unreachable while this module ships without a real implementation —
      // assertWriteActionAllowed always throws today.
      return textResult(`Error: ${name} has no implementation yet in this v1 server.`);
    }),
  );
}

export function registerFutureWriteTools(server: McpServer, ctx: ToolContext): void {
  futureWriteTool(
    server,
    ctx,
    "instagram_publish_media",
    "Publish Instagram Media (Future)",
    "Publish a single image or video post to Instagram.",
    "allowInstagramPublish",
  );
  futureWriteTool(
    server,
    ctx,
    "instagram_publish_carousel",
    "Publish Instagram Carousel (Future)",
    "Publish a multi-image/video carousel post to Instagram.",
    "allowInstagramPublish",
  );
  futureWriteTool(
    server,
    ctx,
    "instagram_publish_reel",
    "Publish Instagram Reel (Future)",
    "Publish a Reel to Instagram.",
    "allowInstagramPublish",
  );
  futureWriteTool(
    server,
    ctx,
    "facebook_publish_post",
    "Publish Facebook Page Post (Future)",
    "Publish a post to the connected Facebook Page.",
    "allowFacebookPublish",
  );
  futureWriteTool(
    server,
    ctx,
    "instagram_reply_to_comment",
    "Reply to Instagram Comment (Future)",
    "Post a reply to a comment on Instagram media.",
    "allowCommentReplies",
  );
  futureWriteTool(
    server,
    ctx,
    "facebook_reply_to_comment",
    "Reply to Facebook Comment (Future)",
    "Post a reply to a comment on a Facebook Page post.",
    "allowCommentReplies",
  );
  futureWriteTool(
    server,
    ctx,
    "reply_to_inbound_message",
    "Reply to Inbound Message (Future)",
    "Send a reply to an inbound Instagram Direct or Facebook Page Messenger conversation.",
    "allowMessageReplies",
  );
}
