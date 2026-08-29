import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./context.js";
import {
  paginationFields,
  responseFormatField,
  textResult,
  truncateForAgent,
  withToolErrorHandling,
  type ToolResult,
} from "./shared.js";
import { getIgUserId } from "../meta/account.js";

export const InstagramListMediaInputSchema = z
  .object({
    ...paginationFields,
    after: z.string().optional().describe("Pagination cursor from a previous call's next_cursor."),
    response_format: responseFormatField,
  })
  .strict();

interface IgMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
}

interface IgMediaEdge {
  data: IgMedia[];
  paging?: { cursors?: { after?: string; before?: string }; next?: string };
}

export function registerInstagramListMedia(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "instagram_list_media",
    {
      title: "List Instagram Media",
      description: `List recent posts, Reels, and carousels published to the connected Instagram Professional account, newest first.

Args:
  - limit (number): Max items to return, 1-100 (default: 25)
  - after (string, optional): Pagination cursor from a previous call's next_cursor
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns: For each media item — id, caption, media_type ('IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'), media_product_type ('FEED' | 'REELS' | 'STORY'), timestamp, permalink, like_count, comments_count. Includes has_more and next_cursor for pagination.

Requires the instagram_business_basic permission. Use the returned media id with instagram_get_media_insights or instagram_list_comments.`,
      inputSchema: InstagramListMediaInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withToolErrorHandling(
      async (params: z.infer<typeof InstagramListMediaInputSchema>): Promise<ToolResult> => {
        const igUserId = getIgUserId(ctx.config);
        const result = await ctx.igClient.get<IgMediaEdge>(`${igUserId}/media`, {
          fields:
            "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
          limit: params.limit,
          after: params.after,
        });

        const items = result.data ?? [];
        const structured = {
          count: items.length,
          items,
          has_more: Boolean(result.paging?.next),
          next_cursor: result.paging?.cursors?.after,
        };

        if (params.response_format === "json") {
          const { text, truncated } = truncateForAgent(JSON.stringify(structured, null, 2));
          return textResult(text, { ...structured, truncated });
        }

        if (!items.length) {
          return textResult("No media found for this Instagram account.", structured);
        }

        const lines = [`# Recent Instagram Media (${items.length})`, ""];
        for (const item of items) {
          lines.push(`## ${item.media_type ?? "MEDIA"} (${item.id})`);
          if (item.caption) {
            const caption =
              item.caption.length > 200 ? `${item.caption.slice(0, 200)}...` : item.caption;
            lines.push(`- **Caption**: ${caption}`);
          }
          if (item.timestamp) lines.push(`- **Posted**: ${item.timestamp}`);
          if (item.media_product_type) lines.push(`- **Type**: ${item.media_product_type}`);
          lines.push(
            `- **Likes**: ${item.like_count ?? "n/a"} | **Comments**: ${item.comments_count ?? "n/a"}`,
          );
          if (item.permalink) lines.push(`- **Link**: ${item.permalink}`);
          lines.push("");
        }
        if (structured.has_more) {
          lines.push(
            `_More results available — pass after="${structured.next_cursor}" to continue._`,
          );
        }

        const { text, truncated } = truncateForAgent(lines.join("\n"));
        return textResult(text, { ...structured, truncated });
      },
    ),
  );
}
