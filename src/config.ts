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
    // Core Meta credentials: a long-lived Instagram User Access Token for
    // Blaise's Instagram Professional account, obtained via "Instagram API
    // with Instagram Login" — no Facebook Page is involved (see
    // docs/META_SETUP.md for why this account-architecture choice, not
    // Facebook Login for Business, is what actually matches Blaise's
    // account). Every Instagram tool calls graph.instagram.com with this
    // token.
    META_IG_ACCESS_TOKEN: z
      .string()
      .min(20, "META_IG_ACCESS_TOKEN looks too short to be a real token"),

    // The numeric Instagram Business Account ID. Meta returns this directly
    // in the OAuth token-exchange response (as `user_id`) — there is no
    // Page to traverse to discover it, so this is required rather than
    // auto-resolved.
    META_IG_USER_ID: z.string().min(1, "META_IG_USER_ID is required"),

    // Only needed for the local token-authorization helper script
    // (npm run token:authorize) and for future long-lived token refreshes.
    // Not required for the server itself to run.
    META_APP_ID: z.string().min(1).optional(),
    META_APP_SECRET: z.string().min(1).optional(),

    GRAPH_API_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/)
      .default(DEFAULT_GRAPH_API_VERSION),

    // --- Optional Facebook Page module (disabled by default) ---
    // Blaise currently has a personal Facebook profile in Professional
    // Mode, not a separate Facebook Page — and Meta's Graph API has no
    // supported way to read posts/insights from a Professional-Mode
    // profile (Page-level access has been Page-only since 2018; see
    // docs/META_SETUP.md#facebook-professional-mode). These tools stay
    // registered but inert unless Blaise later creates/connects an actual
    // Page and opts in here.
    ENABLE_FACEBOOK_PAGE_MODULE: boolFromEnv,
    META_PAGE_ACCESS_TOKEN: z.string().min(20).optional(),
    META_PAGE_ID: z.string().min(1).optional(),

    // Transport
    TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default("127.0.0.1"),

    // The externally reachable base URL of this deployment (e.g.
    // https://blaise-meta-mcp.onrender.com), required when TRANSPORT=http.
    // This is the OAuth issuer/resource identifier — see docs/SECURITY.md
    // for why this server implements OAuth at all. Must be HTTPS unless the
    // host is localhost/127.0.0.1 (for local testing).
    PUBLIC_URL: z
      .string()
      .url()
      .optional()
      .refine(
        (url) =>
          !url ||
          url.startsWith("https://") ||
          /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(url),
        {
          message:
            "PUBLIC_URL must use https:// (http:// is only allowed for localhost/127.0.0.1 during local testing)",
        },
      ),

    // The single password that gates this server's OAuth login screen.
    // Required when TRANSPORT=http. This is the credential Blaise enters
    // once, in the browser, when Claude's "Add custom connector" flow
    // redirects him here to authorize — see docs/SECURITY.md. Unrelated to
    // any Meta/Facebook/Instagram credential above.
    OAUTH_OWNER_PASSWORD: z.string().min(12).optional(),

    // Legacy/optional: a static bearer token accepted as an alternative to
    // an OAuth-issued access token on /mcp. NOT usable with the claude.ai or
    // Claude Desktop "Add custom connector" UI (which only supports OAuth) —
    // this exists solely for clients that let you set a raw Authorization
    // header yourself, e.g. Claude Desktop's local JSON config file or the
    // MCP Inspector during development. Leave unset unless you specifically
    // need that path; OAuth is the primary and recommended mechanism.
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
    if (val.TRANSPORT === "http" && !val.PUBLIC_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PUBLIC_URL"],
        message:
          "PUBLIC_URL is required when TRANSPORT=http — the OAuth authorization server needs a stable, externally reachable issuer URL.",
      });
    }
    if (val.TRANSPORT === "http" && !val.OAUTH_OWNER_PASSWORD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OAUTH_OWNER_PASSWORD"],
        message:
          "OAUTH_OWNER_PASSWORD is required when TRANSPORT=http — a remote server must not accept unauthenticated connections, and this password gates the OAuth login screen.",
      });
    }
    const facebookPageModuleEnabled = val.ENABLE_FACEBOOK_PAGE_MODULE ?? false;
    if (facebookPageModuleEnabled && !val.META_PAGE_ACCESS_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["META_PAGE_ACCESS_TOKEN"],
        message: "META_PAGE_ACCESS_TOKEN is required when ENABLE_FACEBOOK_PAGE_MODULE=true.",
      });
    }
    if (facebookPageModuleEnabled && !val.META_PAGE_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["META_PAGE_ID"],
        message: "META_PAGE_ID is required when ENABLE_FACEBOOK_PAGE_MODULE=true.",
      });
    }
  });

export type AppConfig = {
  metaIgAccessToken: string;
  metaIgUserId: string;
  metaAppId?: string;
  metaAppSecret?: string;
  graphApiVersion: string;
  transport: "stdio" | "http";
  port: number;
  host: string;
  publicUrl?: string;
  oauthOwnerPassword?: string;
  mcpServerAuthToken?: string;
  logLevel: "debug" | "info" | "warn" | "error";
  facebookPage: {
    enabled: boolean;
    pageAccessToken?: string;
    pageId?: string;
  };
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
    metaIgAccessToken: env.META_IG_ACCESS_TOKEN,
    metaIgUserId: env.META_IG_USER_ID,
    metaAppId: env.META_APP_ID,
    metaAppSecret: env.META_APP_SECRET,
    graphApiVersion: env.GRAPH_API_VERSION,
    transport: env.TRANSPORT,
    port: env.PORT,
    host: env.HOST,
    publicUrl: env.PUBLIC_URL,
    oauthOwnerPassword: env.OAUTH_OWNER_PASSWORD,
    mcpServerAuthToken: env.MCP_SERVER_AUTH_TOKEN,
    logLevel: env.LOG_LEVEL,
    facebookPage: {
      enabled: env.ENABLE_FACEBOOK_PAGE_MODULE ?? false,
      pageAccessToken: env.META_PAGE_ACCESS_TOKEN,
      pageId: env.META_PAGE_ID,
    },
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
  return [
    config.metaIgAccessToken,
    config.metaAppSecret,
    config.oauthOwnerPassword,
    config.mcpServerAuthToken,
    config.facebookPage.pageAccessToken,
  ].filter((v): v is string => Boolean(v));
}
