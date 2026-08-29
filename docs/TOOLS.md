# Tools Reference

Every tool in this server is **read-only** (see [SECURITY.md](SECURITY.md) for why, and what's architected-but-disabled for later). Every tool accepts an optional `response_format` (`"markdown"` or `"json"`, default `"markdown"`) and returns both a human-readable text block and, for programmatic use, `structuredContent`.

All Instagram tools operate on the one Instagram Professional account linked to the Facebook Page configured via `META_PAGE_ID` — there's no multi-account switching in v1.

Insights tools (`instagram_get_media_insights`, `instagram_get_account_insights`, `facebook_get_post_insights`) work differently from the others: instead of assuming a fixed metric list, each one requests a candidate set of metrics and, if Meta rejects any as unsupported for that specific object, falls back to fetching each metric individually. The response always includes both what succeeded (`metrics`) and what didn't (`unavailable_metrics`, with Meta's stated reason) — metric availability genuinely varies by media type, account, and Graph API version, and Meta deprecates/renames metrics over time, so a fixed hardcoded list would silently go stale.

---

## `meta_get_account`

Identifies the connected Facebook Page and its linked Instagram Professional account. Call this first to confirm what Claude is connected to.

- **Input**: `response_format`
- **Output**: Page `id`/`name`/`username`/`category`; Instagram `id`/`username`/`name` (if linked)
- **Permissions**: `pages_show_list`, `instagram_basic`

## `instagram_get_profile`

Profile metadata for the connected Instagram account.

- **Input**: `response_format`
- **Output**: `id`, `username`, `name`, `biography`, `website`, `followers_count`, `follows_count`, `media_count`, `account_type`, `profile_picture_url`
- **Permissions**: `instagram_basic`
- **Notes**: Meta may omit some fields depending on account type/privacy — this tool reports whatever comes back rather than assuming every field is present.

## `instagram_list_media`

Recent Instagram posts, Reels, and carousels, newest first.

- **Input**: `limit` (1–100, default 25), `after` (pagination cursor), `response_format`
- **Output**: Per item — `id`, `caption`, `media_type`, `media_product_type`, `timestamp`, `permalink`, `like_count`, `comments_count`. Plus `has_more`/`next_cursor`.
- **Permissions**: `instagram_basic`
- **Use with**: feed `id` into `instagram_get_media_insights` or `instagram_list_comments`.

## `instagram_get_media_insights`

Performance metrics for one media item.

- **Input**: `media_id` (required), `response_format`
- **Output**: `metrics` (metric name → value, whatever Meta confirms is supported for this item — e.g. `reach`, `likes`, `comments`, `saved`, `shares`, `total_interactions`, `views`, `profile_activity`), `unavailable_metrics` (name + reason)
- **Permissions**: `instagram_manage_insights`
- **Notes**: Insights are commonly unavailable for media under ~24 hours old, or for expired Stories. Which metrics apply also depends on `media_product_type` (Feed vs. Reels vs. Carousel) — that's exactly why this tool probes rather than assuming.

## `instagram_get_account_insights`

Account-level reach, profile activity, and audience metrics.

- **Input**: `period` (`day` | `week` | `days_28`, default `day`), `response_format`
- **Output**: `metrics` (e.g. `reach`, `profile_views`, `accounts_engaged`, `total_interactions`, `follower_count`, `website_clicks`), `unavailable_metrics`
- **Permissions**: `instagram_manage_insights`
- **Notes**: Some audience/demographic metrics require a minimum follower count (historically 100) — those show up under `unavailable_metrics` if the account doesn't qualify. Meta's account-insights metric set changes relatively often; check `unavailable_metrics` rather than assuming a metric exists.

## `instagram_list_comments`

Comments left on one Instagram media item.

- **Input**: `media_id` (required), `limit` (1–100, default 25), `after`, `response_format`
- **Output**: Per comment — `id`, `text`, `username`, `timestamp`, `like_count`. Plus `has_more`/`next_cursor`.
- **Permissions**: `instagram_manage_comments` (Meta has no separate read-only comment scope)
- **Notes**: Read-only. Never posts, hides, or deletes a comment.

## `instagram_get_mentions`

Lists media where the account was tagged, and can resolve a specific @mention if you already know its ID.

- **Input**: `limit` (tagged-media list size), `mentioned_media_id` (optional), `mentioned_comment_id` (optional), `response_format`
- **Output**: `tagged_media` (list, from `GET /{ig-user-id}/tags`), plus `resolved_media_mention` / `resolved_comment_mention` if the corresponding ID was passed
- **Permissions**: `instagram_basic` (tags), `instagram_manage_comments` (comment mentions)
- **Known Meta API limitation**: there is no Graph API endpoint that lists every @mention in a caption or comment historically — Meta only supports resolving one once you already know its media/comment ID, which in a full production setup normally comes from a real-time webhook subscription. Webhooks are out of scope for this read-only v1 (they require a public HTTPS endpoint and a review step of their own). This tool exposes what genuinely is listable (tags) and the specific-ID lookup, and says so plainly rather than pretending to offer a full mentions feed.

## `facebook_get_page`

Facebook Page metadata.

- **Input**: `response_format`
- **Output**: `id`, `name`, `username`, `category`, `about`, `link`, `fan_count`, `followers_count`, `picture`
- **Permissions**: `pages_read_engagement`, `pages_show_list`

## `facebook_list_posts`

Recent Facebook Page posts, newest first.

- **Input**: `limit` (1–100, default 25), `after`, `response_format`
- **Output**: Per post — `id`, `message`, `created_time`, `permalink_url`, `status_type`. Plus `has_more`/`next_cursor`.
- **Permissions**: `pages_read_engagement`

## `facebook_get_post_insights`

Performance metrics for one Facebook Page post.

- **Input**: `post_id` (required), `response_format`
- **Output**: `metrics` (e.g. `post_impressions`, `post_impressions_unique`, `post_engaged_users`, `post_clicks`, `post_reactions_by_type_total`, `post_video_views`), `unavailable_metrics`
- **Permissions**: `pages_read_engagement`, `pages_read_user_content`
- **Notes**: Facebook Page Insights metrics are deprecated/replaced by Meta more often than most Graph API surfaces — check `unavailable_metrics` rather than assuming a metric exists.

---

## Error handling, uniformly across every tool

Every tool returns `isError: true` with an actionable message instead of a raw exception, for these cases:

- **Expired/revoked token** → tells you to re-run `npm run token:authorize`.
- **Missing permission** → names the permission the connected token lacks.
- **Rate limited** → tells you to back off rather than retry immediately.
- **Unsupported metric** → only ever surfaces via `unavailable_metrics` in a successful response, never as a hard failure of the whole call (see the dynamic-metric-handling note above).
- **Not found** → the ID you passed doesn't exist or isn't visible to this token.
- **Invalid input** → a Zod validation message naming exactly which field and why.

## Not included in v1 (by design)

No tool in this server can publish, delete, reply, message, follow/unfollow, or otherwise change anything on Instagram or Facebook. See [SECURITY.md](SECURITY.md) for the full reasoning and the architected-but-disabled write layer.
