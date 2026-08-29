/**
 * Default Meta Graph API version. Meta ships a new major version roughly every
 * 6 months and supports each for ~2 years. Check
 * https://developers.facebook.com/docs/graph-api/changelog for the current
 * version and override with the GRAPH_API_VERSION env var as needed — do not
 * assume this constant stays current. (v26.0 as of August 2026; v25.0 is the
 * prior version and remains supported if v26.0 turns out to need a rollback.)
 */
export const DEFAULT_GRAPH_API_VERSION = "v26.0";

/**
 * Blaise's Instagram Professional account is authorized through "Instagram
 * API with Instagram Login" (no Facebook Page involved — see
 * docs/META_SETUP.md for why), so every Instagram data call goes to
 * graph.instagram.com with an Instagram User Access Token, not
 * graph.facebook.com with a Page token.
 */
export const INSTAGRAM_GRAPH_API_BASE_URL = "https://graph.instagram.com";

/**
 * Used only by the optional, disabled-by-default Facebook Page module (see
 * src/tools/facebookPage.ts and ENABLE_FACEBOOK_PAGE_MODULE in config.ts).
 * Facebook Page data lives on the standard Graph API host and requires an
 * actual Page + Page Access Token, which Blaise does not currently have.
 */
export const FACEBOOK_GRAPH_API_BASE_URL = "https://graph.facebook.com";

/** Hard cap on characters returned in a single tool response, to keep results agent-friendly. */
export const CHARACTER_LIMIT = 25000;

export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;

/** Graph API error subcodes that mean "the access token is invalid or expired". */
export const TOKEN_EXPIRED_ERROR_CODES = new Set([190]);

/** Graph API error codes that mean "rate limited, back off". */
export const RATE_LIMIT_ERROR_CODES = new Set([4, 17, 32, 613]);

/** Graph API error codes that mean "missing permission / scope". */
export const PERMISSION_ERROR_CODES = new Set([10, 200, 299]);

/**
 * Candidate metric lists for the /insights endpoints. These are a starting
 * point, not a guarantee — availability depends on media type, account
 * type, and the Graph API version in use, and Meta changes this list over
 * time. Every insights tool requests this full candidate set and falls
 * back to querying metrics individually when Meta rejects one, so an
 * outdated or incomplete list here degrades gracefully instead of failing
 * the whole call. Verify against
 * https://developers.facebook.com/docs/instagram-platform/insights/ before
 * relying on a specific metric being present.
 */
export const CANDIDATE_MEDIA_INSIGHTS_METRICS = [
  "reach",
  "likes",
  "comments",
  "saved",
  "shares",
  "total_interactions",
  "views",
  "profile_activity",
  "follows",
];

// profile_views, website_clicks, phone_call_clicks, text_message_clicks, and
// email_contacts (as standalone time-series metrics) were deprecated by Meta
// on January 8, 2025 in favor of the profile_activity breakdown below and
// the views metric. They're deliberately NOT in this list — an insights tool
// requesting them would just get them reported back as unavailable, but
// there's no reason to request metrics known to be retired.
export const CANDIDATE_ACCOUNT_INSIGHTS_METRICS = [
  "reach",
  "views",
  "profile_activity",
  "accounts_engaged",
  "total_interactions",
  "follower_count",
  "online_followers",
  "get_directions_clicks",
];

export const CANDIDATE_POST_INSIGHTS_METRICS = [
  "post_impressions",
  "post_impressions_unique",
  "post_engaged_users",
  "post_clicks",
  "post_reactions_by_type_total",
  "post_video_views",
];
