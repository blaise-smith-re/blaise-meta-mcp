import {
  PERMISSION_ERROR_CODES,
  RATE_LIMIT_ERROR_CODES,
  TOKEN_EXPIRED_ERROR_CODES,
} from "../constants.js";

/** Shape of the `error` object the Graph API returns on failure. */
export interface GraphApiErrorPayload {
  message: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

export type GraphErrorCategory =
  | "token_expired"
  | "permission_denied"
  | "rate_limited"
  | "unsupported_metric"
  | "not_found"
  | "invalid_request"
  | "unknown";

/**
 * A structured, typed error for every failure mode the Graph API can return.
 * Tool handlers catch this (never a raw fetch/axios error) and turn it into
 * an actionable message for the calling agent.
 */
export class GraphApiError extends Error {
  readonly category: GraphErrorCategory;
  readonly httpStatus: number;
  readonly code?: number;
  readonly errorSubcode?: number;
  readonly fbtraceId?: string;
  readonly graphMessage: string;

  constructor(httpStatus: number, payload: GraphApiErrorPayload) {
    const category = categorize(httpStatus, payload);
    super(`Meta Graph API error (${category}): ${payload.message}`);
    this.name = "GraphApiError";
    this.category = category;
    this.httpStatus = httpStatus;
    this.code = payload.code;
    this.errorSubcode = payload.error_subcode;
    this.fbtraceId = payload.fbtrace_id;
    this.graphMessage = payload.message;
  }

  /** Actionable, agent-facing message. Never includes the access token. */
  toAgentMessage(): string {
    switch (this.category) {
      case "token_expired":
        return (
          "Error: The Meta access token has expired or been revoked. " +
          "Blaise needs to re-run `npm run token:authorize` to generate a new long-lived token " +
          "(see docs/META_SETUP.md) and update META_IG_ACCESS_TOKEN (or META_PAGE_ACCESS_TOKEN " +
          "if this was the optional Facebook Page module)."
        );
      case "permission_denied":
        return (
          `Error: Permission denied by Meta (${this.graphMessage}). ` +
          "The connected token is likely missing a required permission/scope for this operation. " +
          "See docs/TOOLS.md for the permissions each tool needs."
        );
      case "rate_limited":
        return (
          "Error: Meta API rate limit reached. Wait before retrying — " +
          "do not retry in a tight loop, as that extends the throttle window."
        );
      case "unsupported_metric":
        return (
          `Error: One or more requested metrics are not supported for this object (${this.graphMessage}). ` +
          "This tool retries with only the metrics Meta confirms are available; " +
          "if you're calling the Graph API directly, drop the unsupported metric names."
        );
      case "not_found":
        return `Error: The requested Meta object was not found (${this.graphMessage}). Double-check the ID.`;
      case "invalid_request":
        return `Error: Meta rejected the request as invalid (${this.graphMessage}).`;
      default:
        return `Error: Meta Graph API request failed (${this.graphMessage}).`;
    }
  }
}

function categorize(httpStatus: number, payload: GraphApiErrorPayload): GraphErrorCategory {
  const code = payload.code;
  const message = payload.message?.toLowerCase() ?? "";

  if (code !== undefined && TOKEN_EXPIRED_ERROR_CODES.has(code)) return "token_expired";
  if (code !== undefined && RATE_LIMIT_ERROR_CODES.has(code)) return "rate_limited";
  if (code !== undefined && PERMISSION_ERROR_CODES.has(code)) return "permission_denied";
  if (httpStatus === 404) return "not_found";
  if (message.includes("metric") && (message.includes("valid") || message.includes("support"))) {
    return "unsupported_metric";
  }
  if (code === 100) return "invalid_request";
  return "unknown";
}

/** Thrown by a tool handler when Zod input validation fails, for a consistent agent-facing shape. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}
