import { z } from "zod";
import { DEFAULT_GRAPH_API_VERSION } from "./constants.js";

/**
 * Every secret-shaped value the process needs, validated once at startup.
 * Nothing downstream should read process.env directly — go through `loadConfig()`
 * so validation, defaults, and redaction registration all happen in one place.
 */
const boolFromEnv = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => v === "true" || v === "1");

const ConfigSchema = z
  .object({
    // Core Meta credentials. A long-lived Page Access Token is the only token
    // this server needs at runtime for every V1 (read-only) tool: Instagram
    // Professional accounts connected via "Facebook Login for Business" are
    // read and written through their linked Facebook Page's access token.
    META_PAGE_ACCESS_TOKEN: z
      .string()
      .min(20, "META_PAGE_ACCESS_TOKEN looks too short to be a real token"),
    META_PAGE_ID: z.string().min(1, "META_PAGE_ID is required"),

    // Optional: if not set, the server resolves the linked Instagram Business
    // Account ID from META_PAGE_ID on first use and caches it in memory.
    META_IG_USER_ID: z.string().min(1).optional(),

    // Only needed for the local token-authorization helper script
    // (npm run token:authorize) and for future long-lived token refreshes.
    // Not required for the server itself to run.
    META_APP_ID: z.string().min(1).optional(),
    META_APP_SECRET: z.string().min(1).optional(),

    GRAPH_API_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/)
      .default(DEFAULT_GRAPH_API_VERSION),

    // Transport
    TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default("127.0.0.1"),

    // Remote HTTP transport auth: a bearer token clients must present.
    // Required whenever TRANSPORT=http so the server is never exposed unauthenticated.
    MCP_SERVER_AUTH_TOKEN: z.string().min(16).optional(),

    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

    // --- Future write layer (architected, disabled by default) ---
    // The master switch. Every write tool additionally checks its own
    // per-action flag below, so enabling this alone does not enable anything.
    ENABLE_WRITE_ACTIONS: boolFromEnv,
    ALLOW_INSTAGRAM_PUBLISH: boolFromEnv,
    ALLOW_FACEBOOK_PUBLISH: boolFromEnv,
    ALLOW_COMMENT_REPLIES: boolFromEnv,
    ALLOW_MESSAGE_REPLIES: boolFromEnv,
  })
  .superRefine((val, ctx) => {
    if (val.TRANSPORT === "http" && !val.MCP_SERVER_AUTH_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MCP_SERVER_AUTH_TOKEN"],
        message:
          "MCP_SERVER_AUTH_TOKEN is required when TRANSPORT=http — a remote server must not accept unauthenticated connections.",
      });
    }
  });

export type AppConfig = {
  metaPageAccessToken: string;
  metaPageId: string;
  metaIgUserId?: string;
  metaAppId?: string;
  metaAppSecret?: string;
  graphApiVersion: string;
  transport: "stdio" | "http";
  port: number;
  host: string;
  mcpServerAuthToken?: string;
  logLevel: "debug" | "info" | "warn" | "error";
  writeActions: {
    enabled: boolean;
    allowInstagramPublish: boolean;
    allowFacebookPublish: boolean;
    allowCommentReplies: boolean;
    allowMessageReplies: boolean;
  };
};

export class ConfigValidationError extends Error {
  constructor(issues: z.ZodIssue[]) {
    const details = issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    super(`Invalid configuration:\n${details}`);
    this.name = "ConfigValidationError";
  }
}

/**
 * Parses and validates process.env (or a supplied source, for tests) into a
 * typed AppConfig. Throws ConfigValidationError with a readable summary of
 * every problem found, rather than letting the process fail on the first
 * missing variable used at runtime.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = ConfigSchema.safeParse(source);
  if (!result.success) {
    throw new ConfigValidationError(result.error.issues);
  }
  const env = result.data;

  return {
    metaPageAccessToken: env.META_PAGE_ACCESS_TOKEN,
    metaPageId: env.META_PAGE_ID,
    metaIgUserId: env.META_IG_USER_ID,
    metaAppId: env.META_APP_ID,
    metaAppSecret: env.META_APP_SECRET,
    graphApiVersion: env.GRAPH_API_VERSION,
    transport: env.TRANSPORT,
    port: env.PORT,
    host: env.HOST,
    mcpServerAuthToken: env.MCP_SERVER_AUTH_TOKEN,
    logLevel: env.LOG_LEVEL,
    writeActions: {
      enabled: env.ENABLE_WRITE_ACTIONS ?? false,
      allowInstagramPublish: env.ALLOW_INSTAGRAM_PUBLISH ?? false,
      allowFacebookPublish: env.ALLOW_FACEBOOK_PUBLISH ?? false,
      allowCommentReplies: env.ALLOW_COMMENT_REPLIES ?? false,
      allowMessageReplies: env.ALLOW_MESSAGE_REPLIES ?? false,
    },
  };
}

/** Every secret value that must never appear verbatim in logs or error output. */
export function secretsOf(config: AppConfig): string[] {
  return [config.metaPageAccessToken, config.metaAppSecret, config.mcpServerAuthToken].filter(
    (v): v is string => Boolean(v),
  );
}
