import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./context.js";
import {
  responseFormatField,
  textResult,
  withToolErrorHandling,
  type ToolResult,
} from "./shared.js";
import { CANDIDATE_MEDIA_INSIGHTS_METRICS } from "../constants.js";

export const InstagramGetMediaInsightsInputSchema = z
  .object({
    media_id: z.string().min(1).describe("The Instagram media ID, from instagram_list_media."),
    response_format: responseFormatField,
  })
  .strict();

export function registerInstagramGetMediaInsights(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "instagram_get_media_insights",
    {
      title: "Get Instagram Media Insights",
      description: `Fetch performance insights for one Instagram media item (post, Reel, or carousel): reach, views, interactions, shares, saves, and profile-activity metrics where Meta currently supports them for that media type.

Args:
  - media_id (string): The Instagram media ID (from instagram_list_media)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns: A metric -> value map for every metric Meta reports as supported for this specific media item, plus a list of any candidate metrics Meta rejected as unsupported (and why) — metric availability varies by media type (Feed/Reels/Carousel) and account, so this tool probes and reports what's actually available rather than assuming a fixed metric set.

Requires the instagram_manage_insights permission. Insights are typically unavailable for media less than ~24 hours old or for Stories after they expire.`,
      inputSchema: InstagramGetMediaInsightsInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withToolErrorHandling(
      async (params: z.infer<typeof InstagramGetMediaInsightsInputSchema>): Promise<ToolResult> => {
        const { data, unavailableMetrics } = await ctx.client.getInsightsWithFallback(
          `${params.media_id}/insights`,
          CANDIDATE_MEDIA_INSIGHTS_METRICS,
        );

        const metrics: Record<string, unknown> = {};
        for (const m of data) {
          metrics[m.name] = m.values?.[0]?.value ?? m.total_value?.value;
        }

        const structured = {
          media_id: params.media_id,
          metrics,
          unavailable_metrics: unavailableMetrics,
        };

        if (params.response_format === "json") {
          return textResult(JSON.stringify(structured, null, 2), structured);
        }

        const lines = [`# Insights for media ${params.media_id}`, ""];
        if (Object.keys(metrics).length === 0) {
          lines.push("_No insights metrics were available for this media item._");
        } else {
          for (const [name, value] of Object.entries(metrics)) {
            lines.push(`- **${name}**: ${JSON.stringify(value)}`);
          }
        }
        if (unavailableMetrics.length) {
          lines.push("", "_Unavailable for this media:_");
          for (const u of unavailableMetrics) lines.push(`  - ${u.metric}: ${u.reason}`);
        }

        return textResult(lines.join("\n"), structured);
      },
    ),
  );
}
