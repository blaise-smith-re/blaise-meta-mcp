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

export const InstagramGetProfileInputSchema = z
  .object({ response_format: responseFormatField })
  .strict();

interface IgProfile {
  id: string;
  username?: string;
  name?: string;
  biography?: string;
  website?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  profile_picture_url?: string;
  account_type?: string;
}

export function registerInstagramGetProfile(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "instagram_get_profile",
    {
      title: "Get Instagram Profile",
      description: `Fetch profile metadata for the connected Instagram Professional account: username, name, biography, website, and follower/following/media counts where officially available via the Graph API.

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns: id, username, name, biography, website, followers_count, follows_count, media_count, account_type ('BUSINESS' or 'MEDIA_CREATOR'), profile_picture_url.

Requires the instagram_basic permission on the connected token. Some fields (e.g. follows_count) may be omitted by Meta depending on account privacy/type — this tool reports whatever the API returns rather than assuming every field is present.`,
      inputSchema: InstagramGetProfileInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withToolErrorHandling(
      async (params: z.infer<typeof InstagramGetProfileInputSchema>): Promise<ToolResult> => {
        const igUserId = await getIgUserId(ctx.client, ctx.config);
        const profile = await ctx.client.get<IgProfile>(igUserId, {
          fields:
            "id,username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url,account_type",
        });

        if (params.response_format === "json") {
          return textResult(
            JSON.stringify(profile, null, 2),
            profile as unknown as Record<string, unknown>,
          );
        }

        const lines = [
          `# Instagram Profile: @${profile.username ?? profile.id}`,
          "",
          ...(profile.name ? [`- **Name**: ${profile.name}`] : []),
          ...(profile.account_type ? [`- **Account type**: ${profile.account_type}`] : []),
          ...(profile.biography ? [`- **Bio**: ${profile.biography}`] : []),
          ...(profile.website ? [`- **Website**: ${profile.website}`] : []),
          ...(profile.followers_count !== undefined
            ? [`- **Followers**: ${profile.followers_count}`]
            : []),
          ...(profile.follows_count !== undefined
            ? [`- **Following**: ${profile.follows_count}`]
            : []),
          ...(profile.media_count !== undefined ? [`- **Posts**: ${profile.media_count}`] : []),
        ];

        return textResult(lines.join("\n"), profile as unknown as Record<string, unknown>);
      },
    ),
  );
}
