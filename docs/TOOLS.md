# Tools Reference

Every tool in this server is **read-only** (see [SECURITY.md](SECURITY.md) for why, and what's architected-but-disabled for later). Every tool accepts an optional `response_format` (`"markdown"` or `"json"`, default `"markdown"`) and returns both a human-readable text block and, for programmatic use, `structuredContent`.

All Instagram tools operate on the one Instagram Professional account configured via `META_IG_USER_ID`, authorized through "Instagram API with Instagram Login" — there is no Facebook Page involved and no multi-account switching in v1. The three `facebook_*` tools are a separate, **optional, disabled-by-default module** — see their entries below and [SECURITY.md](SECURITY.md#account-architecture-correction).

Insights tools (`instagram_get_media_insights`, `instagram_get_account_insights`, `facebook_get_post_insights`) work differently from the others: instead of assuming a fixed metric list, each one requests a candidate set of metrics and, if Meta rejects any as unsupported for that specific object, falls back to fetching each metric individually. The response always includes both what succeeded (`metrics`) and what didn't (`unavailable_metrics`, with Meta's stated reason) — metric availability genuinely varies by media type, account, and Graph API version, and Meta deprecates/renames metrics over time, so a fixed hardcoded list would silently go stale.

---

## `meta_get_account`

Identifies Blaise's Instagram Professional account, and a Facebook Page only if the optional Facebook Page module is enabled. Call this first to confirm what Claude is connected to.

- **Input**: `response_format`
- **Output**: Instagram `id`/`username`/`name`/`account_type`; `facebook_page` is `null` unless `ENABLE_FACEBOOK_PAGE_MODULE=true` and configured
- **Permissions**: `instagram_business_basic`

## `instagram_get_profile`

Profile metadata for the connected Instagram account.

- **Input**: `response_format`
- **Output**: `id`, `username`, `name`, `biography`, `website`, `followers_count`, `follows_count`, `media_count`, `account_type`, `profile_picture_url`
- **Permissions**: `instagram_business_basic`
- **Notes**: Meta may omit some fields depending on account type/privacy — this tool reports whatever comes back rather than assuming every field is present.

## `instagram_list_media`

Recent Instagram posts, Reels, and carousels, newest first.

- **Input**: `limit` (1–100, default 25), `after` (pagination cursor), `response_format`
- **Output**: Per item — `id`, `caption`, `media_type`, `media_product_type`, `timestamp`, `permalink`, `like_count`, `comments_count`. Plus `has_more`/`next_cursor`.
- **Permissions**: `instagram_business_basic`
- **Use with**: feed `id` into `instagram_get_media_insights` or `instagram_list_comments`.

## `instagram_get_media_insights`

Performance metrics for one media item.

- **Input**: `media_id` (required), `response_format`
- **Output**: `metrics` (metric name → value, whatever Meta confirms is supported for this item — e.g. `reach`, `likes`, `comments`, `saved`, `shares`, `total_interactions`, `views`, `profile_activity`), `unavailable_metrics` (name + reason)
- **Permissions**: `instagram_business_manage_insights`
- **Notes**: Insights are commonly unavailable for media under ~24 hours old, or for expired Stories. Which metrics apply also depends on `media_product_type` (Feed vs. Reels vs. Carousel) — that's exactly why this tool probes rather than assuming.

## `instagram_get_account_insights`

Account-level reach, profile activity, and audience metrics.

- **Input**: `period` (`day` | `week` | `days_28`, default `day`), `response_format`
- **Output**: `metrics` (e.g. `reach`, `views`, `profile_activity`, `accounts_engaged`, `total_interactions`, `follower_count`, `online_followers`, `get_directions_clicks`), `unavailable_metrics`
- **Permissions**: `instagram_business_manage_insights`
- **Notes**: Some audience/demographic metrics require a minimum follower count (historically 100) — those show up under `unavailable_metrics` if the account doesn't qualify. Meta's account-insights metric set changes relatively often — as of this writing, `profile_views`, `website_clicks`, `phone_call_clicks`, `text_message_clicks`, and standalone `email_contacts` are deprecated (retired January 2025) in favor of the `profile_activity` breakdown and `views`; check `unavailable_metrics` rather than assuming any specific metric exists.

## `instagram_list_comments`

Comments left on one Instagram media item.

- **Input**: `media_id` (required), `limit` (1–100, default 25), `after`, `response_format`
- **Output**: Per comment — `id`, `text`, `username`, `timestamp`, `like_count`. Plus `has_more`/`next_cursor`.
- **Permissions**: `instagram_business_manage_comments` (Meta has no separate read-only comment scope)
- **Notes**: Read-only. Never posts, hides, or deletes a comment.

## `instagram_get_mentions`

Resolves a specific @mention of the account in a caption or comment, when you already have its media/comment ID.

- **Input**: `mentioned_media_id` (optional), `mentioned_comment_id` (optional), `response_format`
- **Output**: `resolved_media_mention` / `resolved_comment_mention` for whichever ID(s) were passed. If neither is passed, returns an explanatory message and makes no API call at all.
- **Permissions**: `instagram_business_basic` (caption mentions via `mentioned_media`), `instagram_business_manage_comments` (comment mentions via `mentioned_comment`)
- **Known Meta API limitations**:
  1. There is no Graph API endpoint that lists every @mention historically, under any Instagram auth flow — Meta only supports resolving one once you already know its media/comment ID, which in a full production setup normally comes from a real-time webhook subscription. Webhooks are out of scope for this read-only v1 (they require a public HTTPS endpoint and a review step of their own).
  2. **This tool does NOT list media where the account was photo/video-tagged by others.** An earlier version of this tool also called `GET /{ig-user-id}/tags` for that; that edge is only documented under "Instagram API with Facebook Login for Business," which this server does not use, and has no equivalent under "Instagram API with Instagram Login," which this server does use. That call has been removed rather than left in to fail. **This is a real capability loss compared to the Facebook Login flow** — see the audit table below.

## `instagram_get_mentions` — what changed and why

An earlier version of this tool was named "Get Instagram Mentions and Tags" and additionally listed tagged media via `GET /{ig-user-id}/tags`. A follow-up QC pass found that endpoint is not supported under the Instagram Login flow this server uses (only under Facebook Login for Business), so it was removed rather than shipped as a call that would fail at runtime. The tool name was kept as `instagram_get_mentions` since, with tagging removed, it now accurately describes the tool's only remaining capability. Nothing else about this tool's permissions or behavior changed.

**Capability lost vs. Facebook Login for Business**: listing media where Blaise's account was tagged by other users in a photo/video (as opposed to @mentioned in a caption or comment, which is still supported). There is no workaround for this under Instagram Login — it would require switching back to the Facebook-Login-for-Business flow, which in turn would require Blaise to have an actual Facebook Page (see [SECURITY.md](SECURITY.md#account-architecture-correction)).

## Instagram Login capability audit

Every active V1 Instagram tool, verified against "Instagram API with Instagram Login" (the flow this server uses — see [META_SETUP.md](META_SETUP.md)):

| Tool                             | Endpoint                                                               | Host                  | Token type                  | Permission                                                        | Supported?       | Limitations                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------- | --------------------- | --------------------------- | ----------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `meta_get_account`               | `GET /{ig-user-id}?fields=id,username,name,account_type`               | `graph.instagram.com` | Instagram User Access Token | `instagram_business_basic`                                        | ✅ Yes           | Profile/own-account reads work on either Instagram Login or Facebook Login.                                                   |
| `instagram_get_profile`          | `GET /{ig-user-id}?fields=...`                                         | `graph.instagram.com` | Instagram User Access Token | `instagram_business_basic`                                        | ✅ Yes           | Some fields may be omitted depending on account type/privacy (handled — see tool notes above).                                |
| `instagram_list_media`           | `GET /{ig-user-id}/media`                                              | `graph.instagram.com` | Instagram User Access Token | `instagram_business_basic`                                        | ✅ Yes           | None known beyond standard pagination.                                                                                        |
| `instagram_get_media_insights`   | `GET /{media-id}/insights`                                             | `graph.instagram.com` | Instagram User Access Token | `instagram_business_manage_insights`                              | ✅ Yes           | Metric availability varies by media type/age — handled via dynamic fallback (see above).                                      |
| `instagram_get_account_insights` | `GET /{ig-user-id}/insights`                                           | `graph.instagram.com` | Instagram User Access Token | `instagram_business_manage_insights`                              | ✅ Yes           | Same dynamic-fallback handling; some demographic metrics need a follower-count threshold.                                     |
| `instagram_list_comments`        | `GET /{media-id}/comments`                                             | `graph.instagram.com` | Instagram User Access Token | `instagram_business_manage_comments`                              | ✅ Yes           | Read-only usage only; this server never posts/hides/deletes.                                                                  |
| `instagram_get_mentions`         | `GET /{ig-user-id}?fields=mentioned_media...` / `mentioned_comment...` | `graph.instagram.com` | Instagram User Access Token | `instagram_business_basic` / `instagram_business_manage_comments` | ✅ Yes, narrowed | Single-ID lookup only, no list endpoint (true under any flow); **no tagged-media listing** (Facebook-Login-only — see above). |

Not implemented in this server and confirmed Facebook-Login-only / not applicable to Instagram Login, for completeness: **Business Discovery** (looking up _other_ public accounts' data) and **hashtag search** are both Facebook-Login-exclusive and were never part of this server's scope (Blaise only ever queries his own account). **Tagged-media listing** (`/tags`) is the one capability this server used to reference that is genuinely Facebook-Login-only — see above.

## `facebook_get_page`, `facebook_list_posts`, `facebook_get_post_insights` — OPTIONAL MODULE, disabled by default

**Blaise does not currently have a Facebook Page** — he has a personal Facebook profile in Professional Mode, and Meta's Graph API has no supported way to read Page-equivalent data (posts, insights) from a Professional-Mode profile; Page-level access has required an actual Page since 2018. See [META_SETUP.md](META_SETUP.md#facebook-professional-mode) for the full explanation.

These three tools are fully implemented but **not registered** — Claude cannot see or call them — unless `ENABLE_FACEBOOK_PAGE_MODULE=true` is set along with `META_PAGE_ACCESS_TOKEN` and `META_PAGE_ID` (see `.env.example`). That combination only makes sense if Blaise creates and connects an actual Facebook Page in the future.

If enabled:

- **`facebook_get_page`** — Facebook Page metadata (`id`, `name`, `username`, `category`, `about`, `link`, `fan_count`, `followers_count`, `picture`). Requires `pages_read_engagement`, `pages_show_list`.
- **`facebook_list_posts`** — Recent Facebook Page posts, newest first (`id`, `message`, `created_time`, `permalink_url`, `status_type`, pagination). Requires `pages_read_engagement`.
- **`facebook_get_post_insights`** — Performance metrics for one Facebook Page post (e.g. `post_impressions`, `post_impressions_unique`, `post_engaged_users`, `post_clicks`, `post_reactions_by_type_total`, `post_video_views`), with the same dynamic `unavailable_metrics` handling as the Instagram insights tools. Requires `pages_read_engagement`, `pages_read_user_content`. Facebook Page Insights metrics are deprecated/replaced by Meta more often than most Graph API surfaces — check `unavailable_metrics` rather than assuming a metric exists.

None of the Instagram tools above depend on this module in any way.

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
