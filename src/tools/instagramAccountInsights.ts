import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./context.js";
import {
  responseFormatField,
  textResult,
  withToolErrorHandling,
  type ToolResult,
} from "./shared.js";
import { CANDIDATE_ACCOUNT_INSIGHTS_METRICS } from "../constants.js";
import { getIgUserId } from "../meta/account.js";

export const InstagramGetAccountInsightsInputSchema = z
  .object({
    period: z
      .enum(["day", "week", "days_28"])
      .default("day")
      .describe("Aggregation window Meta supports for account-level insights."),
    response_format: responseFormatField,
  })
  .strict();

export function registerInstagramGetAccountInsights(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "instagram_get_account_insights",
    {
      title: "Get Instagram Account Insights",
      description: `Fetch account-level insights and audience information for the connected Instagram Professional account: reach, profile views, accounts engaged, follower count, and related metrics currently supported by Meta.

Args:
  - period ('day' | 'week' | 'days_28'): Aggregation window (default: 'day')
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns: A metric -> value map for every account-level metric Meta reports as supported, plus a list of any candidate metrics Meta rejected as unsupported (and why). Account-level insights availability and required permissions change more often than most Graph API surfaces, so this tool probes rather than assuming a fixed metric set.

Requires the instagram_business_manage_insights permission. Meta requires a minimum follower count (historically 100) for some audience-demographics metrics — those will show up under unavailable_metrics if the account doesn't qualify.`,
      inputSchema: InstagramGetAccountInsightsInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withToolErrorHandling(
      async (
        params: z.infer<typeof InstagramGetAccountInsightsInputSchema>,
      ): Promise<ToolResult> => {
        const igUserId = getIgUserId(ctx.config);
        const { data, unavailableMetrics } = await ctx.igClient.getInsightsWithFallback(
          `${igUserId}/insights`,
          CANDIDATE_ACCOUNT_INSIGHTS_METRICS,
          { period: params.period, metric_type: "total_value" },
        );

        const metrics: Record<string, unknown> = {};
        for (const m of data) {
          metrics[m.name] = m.total_value?.value ?? m.values?.[0]?.value;
        }

        const structured = {
          period: params.period,
          metrics,
          unavailable_metrics: unavailableMetrics,
        };

        if (params.response_format === "json") {
          return textResult(JSON.stringify(structured, null, 2), structured);
        }

        const lines = [`# Instagram Account Insights (period: ${params.period})`, ""];
        if (Object.keys(metrics).length === 0) {
          lines.push("_No account-level insights metrics were available._");
        } else {
          for (const [name, value] of Object.entries(metrics)) {
            lines.push(`- **${name}**: ${JSON.stringify(value)}`);
          }
        }
        if (unavailableMetrics.length) {
          lines.push("", "_Unavailable:_");
          for (const u of unavailableMetrics) lines.push(`  - ${u.metric}: ${u.reason}`);
        }

        return textResult(lines.join("\n"), structured);
      },
    ),
  );
}
