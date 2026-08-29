import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./context.js";
import {
  responseFormatField,
  textResult,
  withToolErrorHandling,
  type ToolResult,
} from "./shared.js";
import { resolveAccount } from "../meta/account.js";

export const MetaGetAccountInputSchema = z
  .object({ response_format: responseFormatField })
  .strict();

export function registerMetaGetAccount(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "meta_get_account",
    {
      title: "Get Connected Meta Account",
      description: `Identify the Meta assets this server is connected to: the Facebook Page and, if linked, its Instagram Professional (Business or Creator) account.

Use this first to confirm which account Claude is talking to before calling any other tool — it returns IDs you'll reuse implicitly (every other tool targets the same connected account automatically).

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns: Facebook Page id/name/username/category, and Instagram account id/username/name when a Professional account is linked to the Page.

Does NOT return follower counts or media (use instagram_get_profile / facebook_get_page for those) — this tool is identity-only.`,
      inputSchema: MetaGetAccountInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withToolErrorHandling(
      async (params: z.infer<typeof MetaGetAccountInputSchema>): Promise<ToolResult> => {
        const account = await resolveAccount(ctx.client, ctx.config);

        const structured = {
          facebook_page: account.page,
          instagram_account: account.instagram ?? null,
        };

        if (params.response_format === "json") {
          return textResult(JSON.stringify(structured, null, 2), structured);
        }

        const lines = [
          "# Connected Meta Account",
          "",
          `## Facebook Page`,
          `- **Name**: ${account.page.name} (${account.page.id})`,
          ...(account.page.username ? [`- **Username**: @${account.page.username}`] : []),
          ...(account.page.category ? [`- **Category**: ${account.page.category}`] : []),
          "",
        ];
        if (account.instagram) {
          lines.push(
            "## Instagram Professional Account",
            `- **ID**: ${account.instagram.id}`,
            ...(account.instagram.username
              ? [`- **Username**: @${account.instagram.username}`]
              : []),
            ...(account.instagram.name ? [`- **Name**: ${account.instagram.name}`] : []),
          );
        } else {
          lines.push(
            "## Instagram Professional Account",
            "_No Instagram Professional account is linked to this Facebook Page._",
          );
        }

        return textResult(lines.join("\n"), structured);
      },
    ),
  );
}
