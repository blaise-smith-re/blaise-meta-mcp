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

export const FacebookListPostsInputSchema = z
  .object({
    ...paginationFields,
    after: z.string().optional().describe("Pagination cursor from a previous call's next_cursor."),
    response_format: responseFormatField,
  })
  .strict();

interface FbPost {
  id: string;
  message?: string;
  created_time?: string;
  permalink_url?: string;
  status_type?: string;
}

interface FbPostEdge {
  data: FbPost[];
  paging?: { cursors?: { after?: string }; next?: string };
}

export function registerFacebookListPosts(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "facebook_list_posts",
    {
      title: "List Facebook Page Posts",
      description: `OPTIONAL FACEBOOK PAGE MODULE — only registered when ENABLE_FACEBOOK_PAGE_MODULE=true and a real Facebook Page is configured (see docs/META_SETUP.md#facebook-professional-mode). Requires an actual Facebook Page, not a Professional-Mode personal profile. List recent posts published to that connected Facebook Page, newest first.

Args:
  - limit (number): Max posts to return, 1-100 (default: 25)
  - after (string, optional): Pagination cursor from a previous call's next_cursor
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns: For each post — id, message, created_time, permalink_url, status_type. Includes has_more and next_cursor for pagination.

Requires the pages_read_engagement permission. Use the returned post id with facebook_get_post_insights.`,
      inputSchema: FacebookListPostsInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withToolErrorHandling(
      async (params: z.infer<typeof FacebookListPostsInputSchema>): Promise<ToolResult> => {
        const result = await ctx.fbClient!.get<FbPostEdge>(
          `${ctx.config.facebookPage.pageId}/posts`,
          {
            fields: "id,message,created_time,permalink_url,status_type",
            limit: params.limit,
            after: params.after,
          },
        );

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
          return textResult("No posts found for this Facebook Page.", structured);
        }

        const lines = [`# Recent Facebook Page Posts (${items.length})`, ""];
        for (const p of items) {
          lines.push(`## ${p.id}`);
          if (p.message) {
            const msg = p.message.length > 200 ? `${p.message.slice(0, 200)}...` : p.message;
            lines.push(`- **Message**: ${msg}`);
          }
          if (p.created_time) lines.push(`- **Posted**: ${p.created_time}`);
          if (p.permalink_url) lines.push(`- **Link**: ${p.permalink_url}`);
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
