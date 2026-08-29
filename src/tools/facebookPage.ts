import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./context.js";
import {
  responseFormatField,
  textResult,
  withToolErrorHandling,
  type ToolResult,
} from "./shared.js";

export const FacebookGetPageInputSchema = z
  .object({ response_format: responseFormatField })
  .strict();

interface FbPage {
  id: string;
  name?: string;
  username?: string;
  category?: string;
  about?: string;
  link?: string;
  fan_count?: number;
  followers_count?: number;
  picture?: { data?: { url?: string } };
}

export function registerFacebookGetPage(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "facebook_get_page",
    {
      title: "Get Facebook Page",
      description: `OPTIONAL FACEBOOK PAGE MODULE — only registered when ENABLE_FACEBOOK_PAGE_MODULE=true and a real Facebook Page is configured (see docs/META_SETUP.md#facebook-professional-mode). Fetch metadata for that connected Facebook Page: name, username, category, about text, link, and public follower/like counts.

This requires an actual Facebook Page, not a personal profile in Professional Mode — Meta's Graph API has no supported way to read Page-equivalent data from a Professional-Mode personal profile.

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns: id, name, username, category, about, link, fan_count, followers_count, picture URL.

Requires the pages_read_engagement and pages_show_list permissions on the connected Page Access Token.`,
      inputSchema: FacebookGetPageInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withToolErrorHandling(
      async (params: z.infer<typeof FacebookGetPageInputSchema>): Promise<ToolResult> => {
        const page = await ctx.fbClient!.get<FbPage>(ctx.config.facebookPage.pageId!, {
          fields: "id,name,username,category,about,link,fan_count,followers_count,picture{url}",
        });

        if (params.response_format === "json") {
          return textResult(
            JSON.stringify(page, null, 2),
            page as unknown as Record<string, unknown>,
          );
        }

        const lines = [
          `# Facebook Page: ${page.name ?? page.id}`,
          "",
          ...(page.username ? [`- **Username**: @${page.username}`] : []),
          ...(page.category ? [`- **Category**: ${page.category}`] : []),
          ...(page.about ? [`- **About**: ${page.about}`] : []),
          ...(page.fan_count !== undefined ? [`- **Likes**: ${page.fan_count}`] : []),
          ...(page.followers_count !== undefined
            ? [`- **Followers**: ${page.followers_count}`]
            : []),
          ...(page.link ? [`- **Link**: ${page.link}`] : []),
        ];

        return textResult(lines.join("\n"), page as unknown as Record<string, unknown>);
      },
    ),
  );
}
