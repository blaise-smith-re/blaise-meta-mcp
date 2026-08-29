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

export const InstagramListCommentsInputSchema = z
  .object({
    media_id: z.string().min(1).describe("The Instagram media ID to fetch comments for."),
    ...paginationFields,
    after: z.string().optional().describe("Pagination cursor from a previous call's next_cursor."),
    response_format: responseFormatField,
  })
  .strict();

interface IgComment {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
  like_count?: number;
}

interface IgCommentEdge {
  data: IgComment[];
  paging?: { cursors?: { after?: string }; next?: string };
}

export function registerInstagramListComments(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "instagram_list_comments",
    {
      title: "List Instagram Media Comments",
      description: `Retrieve comments left on one of Blaise's Instagram media items.

Args:
  - media_id (string): The Instagram media ID (from instagram_list_media)
  - limit (number): Max comments to return, 1-100 (default: 25)
  - after (string, optional): Pagination cursor from a previous call's next_cursor
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns: For each comment — id, text, username, timestamp, like_count. Includes has_more and next_cursor for pagination.

Requires the instagram_manage_comments permission (Meta does not offer a read-only comment-listing scope separate from manage). This tool only reads comments — it never posts, hides, or deletes any (see docs/SECURITY.md for the disabled write layer).`,
      inputSchema: InstagramListCommentsInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withToolErrorHandling(
      async (params: z.infer<typeof InstagramListCommentsInputSchema>): Promise<ToolResult> => {
        const result = await ctx.client.get<IgCommentEdge>(`${params.media_id}/comments`, {
          fields: "id,text,username,timestamp,like_count",
          limit: params.limit,
          after: params.after,
        });

        const items = result.data ?? [];
        const structured = {
          media_id: params.media_id,
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
          return textResult(`No comments found on media ${params.media_id}.`, structured);
        }

        const lines = [`# Comments on ${params.media_id} (${items.length})`, ""];
        for (const c of items) {
          lines.push(
            `- **@${c.username ?? "unknown"}** (${c.timestamp ?? "n/a"}): ${c.text ?? ""}`,
          );
        }
        if (structured.has_more) {
          lines.push(
            "",
            `_More results available — pass after="${structured.next_cursor}" to continue._`,
          );
        }

        const { text, truncated } = truncateForAgent(lines.join("\n"));
        return textResult(text, { ...structured, truncated });
      },
    ),
  );
}
