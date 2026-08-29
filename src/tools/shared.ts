import { z } from "zod";
import { CHARACTER_LIMIT, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../constants.js";
import { GraphApiError, ToolInputError } from "../meta/errors.js";
import { WriteActionsDisabledError } from "../meta/writeGuard.js";
import { logger } from "../logger.js";

export const ResponseFormat = z.enum(["markdown", "json"]);
export type ResponseFormatType = z.infer<typeof ResponseFormat>;

export const responseFormatField = ResponseFormat.default("markdown").describe(
  "Output format: 'markdown' for human-readable or 'json' for machine-readable.",
);

export const paginationFields = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_LIMIT)
    .default(DEFAULT_PAGE_LIMIT)
    .describe(`Maximum results to return (1-${MAX_PAGE_LIMIT}, default ${DEFAULT_PAGE_LIMIT}).`),
};

/** MCP tool return shape (subset of the SDK's CallToolResult used across this server). */
export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export function textResult(text: string, structuredContent?: Record<string, unknown>): ToolResult {
  return structuredContent
    ? { content: [{ type: "text", text }], structuredContent }
    : { content: [{ type: "text", text }] };
}

export function truncateForAgent(text: string): { text: string; truncated: boolean } {
  if (text.length <= CHARACTER_LIMIT) return { text, truncated: false };
  return {
    text:
      text.slice(0, CHARACTER_LIMIT) +
      `\n\n[Response truncated at ${CHARACTER_LIMIT} characters. Use 'limit' or add filters to reduce result size.]`,
    truncated: true,
  };
}

/**
 * Wraps every tool handler so errors always come back as a well-formed
 * MCP tool result (isError: true) with an actionable message, instead of
 * throwing and producing a bare protocol-level error. Centralizing this
 * means every tool gets the same, tested error taxonomy.
 */
export function withToolErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<ToolResult>,
): (...args: Args) => Promise<ToolResult> {
  return async (...args: Args): Promise<ToolResult> => {
    try {
      return await handler(...args);
    } catch (error) {
      return { content: [{ type: "text", text: describeError(error) }], isError: true };
    }
  };
}

export function describeError(error: unknown): string {
  if (error instanceof GraphApiError) {
    logger.error("Graph API error", {
      category: error.category,
      code: error.code,
      subcode: error.errorSubcode,
      fbtraceId: error.fbtraceId,
    });
    return error.toAgentMessage();
  }
  if (error instanceof ToolInputError) {
    return `Error: Invalid input — ${error.message}`;
  }
  if (error instanceof WriteActionsDisabledError) {
    return `Error: ${error.message}`;
  }
  if (error instanceof z.ZodError) {
    const details = error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return `Error: Invalid input — ${details}`;
  }
  const message = error instanceof Error ? error.message : String(error);
  logger.error("Unexpected tool error", { message });
  return `Error: ${message}`;
}
