import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./context.js";
import {
  responseFormatField,
  textResult,
  withToolErrorHandling,
  type ToolResult,
} from "./shared.js";
import { CANDIDATE_POST_INSIGHTS_METRICS } from "../constants.js";

export const FacebookGetPostInsightsInputSchema = z
  .object({
    post_id: z.string().min(1).describe("The Facebook post ID, from facebook_list_posts."),
    response_format: responseFormatField,
  })
  .strict();

export function registerFacebookGetPostInsights(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "facebook_get_post_insights",
    {
      title: "Get Facebook Post Insights",
      description: `Fetch performance insights for one Facebook Page post: impressions, engaged users, clicks, reactions, and video views where currently supported by Meta.

Args:
  - post_id (string): The Facebook post ID (from facebook_list_posts)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns: A metric -> value map for every metric Meta reports as supported for this post, plus a list of any candidate metrics Meta rejected as unsupported (and why). Facebook Page Insights metrics are deprecated and replaced by Meta more often than most Graph API surfaces, so this tool probes rather than assuming a fixed metric set.

Requires the pages_read_engagement permission (also pages_read_user_content for some engagement breakdowns).`,
      inputSchema: FacebookGetPostInsightsInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withToolErrorHandling(
      async (params: z.infer<typeof FacebookGetPostInsightsInputSchema>): Promise<ToolResult> => {
        const { data, unavailableMetrics } = await ctx.client.getInsightsWithFallback(
          `${params.post_id}/insights`,
          CANDIDATE_POST_INSIGHTS_METRICS,
        );

        const metrics: Record<string, unknown> = {};
        for (const m of data) {
          metrics[m.name] = m.values?.[0]?.value ?? m.total_value?.value;
        }

        const structured = {
          post_id: params.post_id,
          metrics,
          unavailable_metrics: unavailableMetrics,
        };

        if (params.response_format === "json") {
          return textResult(JSON.stringify(structured, null, 2), structured);
        }

        const lines = [`# Insights for post ${params.post_id}`, ""];
        if (Object.keys(metrics).length === 0) {
          lines.push("_No insights metrics were available for this post._");
        } else {
          for (const [name, value] of Object.entries(metrics)) {
            lines.push(`- **${name}**: ${JSON.stringify(value)}`);
          }
        }
        if (unavailableMetrics.length) {
          lines.push("", "_Unavailable for this post:_");
          for (const u of unavailableMetrics) lines.push(`  - ${u.metric}: ${u.reason}`);
        }

        return textResult(lines.join("\n"), structured);
      },
    ),
  );
}
