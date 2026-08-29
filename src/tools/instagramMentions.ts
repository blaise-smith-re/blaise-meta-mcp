import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./context.js";
import {
  responseFormatField,
  textResult,
  withToolErrorHandling,
  type ToolResult,
} from "./shared.js";
import { getIgUserId } from "../meta/account.js";
import { GraphApiError } from "../meta/errors.js";

/**
 * NARROWED FROM THE ORIGINAL DESIGN: this tool used to also list media where
 * the account was photo/video-tagged, via GET /{ig-user-id}/tags. That edge
 * is only documented under the Facebook-Login-for-Business Instagram Graph
 * API reference, not under "Instagram API with Instagram Login" (which this
 * server now uses — see docs/META_SETUP.md) — Meta's Instagram Login docs
 * do not expose a tagged-media listing endpoint, and there is no
 * alternative endpoint that provides it under this auth flow. Calling it
 * would fail. The /tags call has been removed entirely rather than left in
 * to fail at runtime; see docs/TOOLS.md for exactly what capability this
 * cost compared to the Facebook Login flow.
 */
export const InstagramGetMentionsInputSchema = z
  .object({
    // Meta only exposes single-item lookups for @mentions in a caption or
    // comment (mentioned_media / mentioned_comment) — there is no "list all
    // mentions" edge under any Instagram auth flow. These IDs typically come
    // from a webhook notification payload Blaise has already received.
    mentioned_media_id: z
      .string()
      .optional()
      .describe(
        "A specific media ID (usually from a webhook notification) to look up a caption @mention for.",
      ),
    mentioned_comment_id: z
      .string()
      .optional()
      .describe(
        "A specific comment ID (usually from a webhook notification) to look up a comment @mention for.",
      ),
    response_format: responseFormatField,
  })
  .strict();

export function registerInstagramGetMentions(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "instagram_get_mentions",
    {
      title: "Get Instagram Mentions",
      description: `Resolve a specific @mention of the connected account in an Instagram caption or comment, when you already have its media or comment ID.

Args:
  - mentioned_media_id (string, optional): Look up a caption @mention on a specific media ID
  - mentioned_comment_id (string, optional): Look up a comment @mention on a specific comment ID
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns: resolved_media_mention / resolved_comment_mention for whichever ID(s) were passed. If neither is passed, returns an explanatory message rather than a list — see the limitation below.

IMPORTANT LIMITATIONS (Meta API constraints, not bugs):
1. There is no Graph API endpoint that lists every @mention historically, under any Instagram auth flow. Meta only supports resolving one once you already know its media/comment ID, which in a full production setup normally comes from a real-time webhook subscription (out of scope for this read-only v1 server).
2. This tool does NOT list media where the account was photo/video-tagged by others. That capability (the /tags edge) is only available through "Instagram API with Facebook Login for Business", which this server does not use (Blaise's account has no linked Facebook Page — see docs/META_SETUP.md). It is not available through "Instagram API with Instagram Login", which this server does use, and there is no equivalent endpoint under that flow. This is a real capability gap versus the Facebook Login flow, not something this tool works around.

Requires the instagram_business_manage_comments permission for comment mentions and instagram_business_basic for caption/media mentions.`,
      inputSchema: InstagramGetMentionsInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withToolErrorHandling(
      async (params: z.infer<typeof InstagramGetMentionsInputSchema>): Promise<ToolResult> => {
        if (!params.mentioned_media_id && !params.mentioned_comment_id) {
          const message =
            "No mentioned_media_id or mentioned_comment_id was provided. Meta's API has no endpoint " +
            "that lists all @mentions — pass a specific media or comment ID (typically from a webhook " +
            "notification) to resolve one.";
          return textResult(message, {
            resolved_media_mention: null,
            resolved_comment_mention: null,
            lookup_errors: [],
          });
        }

        const igUserId = getIgUserId(ctx.config);

        let resolvedMediaMention: unknown;
        let resolvedCommentMention: unknown;
        const lookupErrors: string[] = [];

        if (params.mentioned_media_id) {
          try {
            resolvedMediaMention = await ctx.igClient.get(igUserId, {
              fields: `mentioned_media.media_id(${params.mentioned_media_id}){id,caption,media_type,permalink,timestamp}`,
            });
          } catch (error) {
            lookupErrors.push(
              `mentioned_media_id lookup failed: ${error instanceof GraphApiError ? error.toAgentMessage() : String(error)}`,
            );
          }
        }

        if (params.mentioned_comment_id) {
          try {
            resolvedCommentMention = await ctx.igClient.get(igUserId, {
              fields: `mentioned_comment.comment_id(${params.mentioned_comment_id}){id,text,username,timestamp}`,
            });
          } catch (error) {
            lookupErrors.push(
              `mentioned_comment_id lookup failed: ${error instanceof GraphApiError ? error.toAgentMessage() : String(error)}`,
            );
          }
        }

        const structured = {
          resolved_media_mention: resolvedMediaMention ?? null,
          resolved_comment_mention: resolvedCommentMention ?? null,
          lookup_errors: lookupErrors,
        };

        if (params.response_format === "json") {
          return textResult(JSON.stringify(structured, null, 2), structured);
        }

        const lines = [`# Instagram Mentions`, ""];
        if (resolvedMediaMention) {
          lines.push(
            "## Resolved Caption Mention",
            "```json",
            JSON.stringify(resolvedMediaMention, null, 2),
            "```",
          );
        }
        if (resolvedCommentMention) {
          lines.push(
            "## Resolved Comment Mention",
            "```json",
            JSON.stringify(resolvedCommentMention, null, 2),
            "```",
          );
        }
        if (lookupErrors.length) {
          lines.push("", "## Lookup Errors", ...lookupErrors.map((e) => `- ${e}`));
        }
        if (!resolvedMediaMention && !resolvedCommentMention && !lookupErrors.length) {
          lines.push("_No mention resolved._");
        }

        return textResult(lines.join("\n"), structured);
      },
    ),
  );
}
