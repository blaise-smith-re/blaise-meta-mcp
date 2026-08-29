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

export const MetaGetAccountInputSchema = z
  .object({ response_format: responseFormatField })
  .strict();

interface IgIdentity {
  id: string;
  username?: string;
  name?: string;
  account_type?: string;
}

interface FbPageIdentity {
  id: string;
  name?: string;
  username?: string;
  category?: string;
}

export function registerMetaGetAccount(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "meta_get_account",
    {
      title: "Get Connected Meta Account",
      description: `Identify the Meta account(s) this server is connected to: Blaise's Instagram Professional account (always), and a Facebook Page (only if the optional Facebook Page module is enabled — see docs/META_SETUP.md).

Use this first to confirm which account Claude is talking to before calling any other tool — it returns IDs you'll reuse implicitly (every other tool targets the same connected account automatically).

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns: Instagram account id/username/name/account_type. Facebook Page id/name/username/category only if ENABLE_FACEBOOK_PAGE_MODULE=true — otherwise facebook_page is null, because Blaise does not currently have a Facebook Page (see docs/META_SETUP.md#facebook-professional-mode).

Does NOT return follower counts or media (use instagram_get_profile for those) — this tool is identity-only.`,
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
        const igUserId = getIgUserId(ctx.config);
        const instagram = await ctx.igClient.get<IgIdentity>(igUserId, {
          fields: "id,username,name,account_type",
        });

        let facebookPage: FbPageIdentity | null = null;
        if (ctx.fbClient && ctx.config.facebookPage.pageId) {
          facebookPage = await ctx.fbClient.get<FbPageIdentity>(ctx.config.facebookPage.pageId, {
            fields: "id,name,username,category",
          });
        }

        const structured = { instagram_account: instagram, facebook_page: facebookPage };

        if (params.response_format === "json") {
          return textResult(JSON.stringify(structured, null, 2), structured);
        }

        const lines = [
          "# Connected Meta Account",
          "",
          "## Instagram Professional Account",
          `- **ID**: ${instagram.id}`,
          ...(instagram.username ? [`- **Username**: @${instagram.username}`] : []),
          ...(instagram.name ? [`- **Name**: ${instagram.name}`] : []),
          ...(instagram.account_type ? [`- **Account type**: ${instagram.account_type}`] : []),
          "",
        ];
        if (facebookPage) {
          lines.push(
            "## Facebook Page",
            `- **Name**: ${facebookPage.name} (${facebookPage.id})`,
            ...(facebookPage.username ? [`- **Username**: @${facebookPage.username}`] : []),
            ...(facebookPage.category ? [`- **Category**: ${facebookPage.category}`] : []),
          );
        } else {
          lines.push(
            "## Facebook Page",
            "_No Facebook Page connected — the optional Facebook Page module is disabled. Blaise currently has a personal Facebook profile in Professional Mode, not a Page; see docs/META_SETUP.md#facebook-professional-mode._",
          );
        }

        return textResult(lines.join("\n"), structured);
      },
    ),
  );
}
