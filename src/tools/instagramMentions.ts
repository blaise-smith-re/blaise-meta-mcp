import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./context.js";
import {
  paginationFields,
  responseFormatField,
  textResult,
  withToolErrorHandling,
  type ToolResult,
} from "./shared.js";
import { getIgUserId } from "../meta/account.js";
import { GraphApiError } from "../meta/errors.js";

export const InstagramGetMentionsInputSchema = z
  .object({
    ...paginationFields,
    // Meta only exposes single-item lookups for @mentions in a caption or
    // comment (mentioned_media / mentioned_comment) — there is no "list all
    // mentions" edge. These optional IDs typically come from a webhook
    // notification payload Blaise has already received.
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

interface IgTaggedMedia {
  id: string;
  caption?: string;
  media_type?: string;
  permalink?: string;
  timestamp?: string;
  username?: string;
}

export function registerInstagramGetMentions(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "instagram_get_mentions",
    {
      title: "Get Instagram Mentions and Tags",
      description: `List Instagram media where the connected account has been tagged by other users (photo/video tags via GET /{ig-user-id}/tags), and optionally resolve a specific @mention in a caption or comment when you already have its media/comment ID.

Args:
  - limit (number): Max tagged media items to return, 1-100 (default: 25)
  - mentioned_media_id (string, optional): Look up a caption @mention on a specific media ID
  - mentioned_comment_id (string, optional): Look up a comment @mention on a specific comment ID
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns: A list of tagged media (id, caption, media_type, permalink, timestamp, tagging username), plus the resolved @mention details if mentioned_media_id or mentioned_comment_id was provided.

IMPORTANT LIMITATION (this is a Meta API constraint, not a bug): the Graph API has no endpoint that lists every caption/comment @mention historically. Meta only supports resolving a specific @mention once you already know its media or comment ID — in production that ID normally comes from a real-time webhook subscription (out of scope for this read-only v1 server; see docs/TOOLS.md). This tool lists what IS listable (tags) and resolves specific mentions on request.

Requires the instagram_manage_comments permission for comment mentions and instagram_basic for tags/media mentions.`,
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
        const igUserId = await getIgUserId(ctx.client, ctx.config);

        const tagged = await ctx.client.get<{ data: IgTaggedMedia[] }>(`${igUserId}/tags`, {
          fields: "id,caption,media_type,permalink,timestamp,username",
          limit: params.limit,
        });

        let resolvedMediaMention: unknown;
        let resolvedCommentMention: unknown;
        const lookupErrors: string[] = [];

        if (params.mentioned_media_id) {
          try {
            resolvedMediaMention = await ctx.client.get(igUserId, {
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
            resolvedCommentMention = await ctx.client.get(igUserId, {
              fields: `mentioned_comment.comment_id(${params.mentioned_comment_id}){id,text,username,timestamp}`,
            });
          } catch (error) {
            lookupErrors.push(
              `mentioned_comment_id lookup failed: ${error instanceof GraphApiError ? error.toAgentMessage() : String(error)}`,
            );
          }
        }

        const structured = {
          tagged_media: tagged.data ?? [],
          resolved_media_mention: resolvedMediaMention ?? null,
          resolved_comment_mention: resolvedCommentMention ?? null,
          lookup_errors: lookupErrors,
        };

        if (params.response_format === "json") {
          return textResult(JSON.stringify(structured, null, 2), structured);
        }

        const lines = [
          `# Instagram Tags & Mentions`,
          "",
          `## Tagged Media (${structured.tagged_media.length})`,
        ];
        if (!structured.tagged_media.length) {
          lines.push("_None found._");
        } else {
          for (const m of structured.tagged_media) {
            lines.push(
              `- **${m.media_type ?? "MEDIA"}** by @${m.username ?? "unknown"} (${m.id}) — ${m.permalink ?? ""}`,
            );
          }
        }
        if (resolvedMediaMention) {
          lines.push(
            "",
            "## Resolved Caption Mention",
            "```json",
            JSON.stringify(resolvedMediaMention, null, 2),
            "```",
          );
        }
        if (resolvedCommentMention) {
          lines.push(
            "",
            "## Resolved Comment Mention",
            "```json",
            JSON.stringify(resolvedCommentMention, null, 2),
            "```",
          );
        }
        if (lookupErrors.length) {
          lines.push("", "## Lookup Errors", ...lookupErrors.map((e) => `- ${e}`));
        }

        return textResult(lines.join("\n"), structured);
      },
    ),
  );
}
