# Meta Developer Setup Guide

This walks you (Blaise) through creating and configuring the Meta app this server needs. You do not need to write any code. It should take 30–45 minutes.

**This guide was corrected after verifying Blaise's actual Meta account structure.** An earlier version assumed a separate Facebook Page existed. It doesn't: Blaise has one personal Facebook profile (Professional Mode enabled), and his Instagram Professional account is linked to that profile through Accounts Center, not to a Page. Everything below reflects the login flow that actually matches that setup — **Instagram API with Instagram Login**, not Facebook Login for Business. See [SECURITY.md](SECURITY.md#account-architecture-correction) for why this changed.

**Meta redesigns its Developer Dashboard periodically**, so a button or menu label below might have moved slightly by the time you do this. If something doesn't match exactly, look for the nearest equivalent — the underlying steps (create app → add product → configure permissions → generate token) don't change often. When in doubt, the authoritative source is [developers.facebook.com/docs/instagram-platform](https://developers.facebook.com/docs/instagram-platform/).

## Before you start: prerequisites

1. **Your Instagram account must be a Professional account** (Business or Creator), not a personal account.
   - In the Instagram app: Settings → Account type and tools → Switch to Professional Account.
2. **That's it — no Facebook Page is required.** Your Instagram account can be linked to your personal Facebook profile through Accounts Center (Settings → Account Center), which is the setup you already have. You do **not** need to create a Facebook Page to complete this guide.

If step 1 isn't true yet, fix it first — nothing below will work without it.

## Step 1: Create a Meta Developer account

1. Go to [developers.facebook.com](https://developers.facebook.com) and log in with your personal Facebook account (the one your Instagram account is linked to via Accounts Center).
2. If you've never used the Developer site before, you'll be prompted to register as a developer (accept the terms, verify your account — sometimes by phone/email).

## Step 2: Create the app

1. From the Developer Dashboard, click **My Apps** → **Create App**.
2. Meta will ask what you're building. Choose the **Business** app type.
3. Give it a name (e.g. "Blaise Meta MCP" or "Buy Sell Home Team Integration") — this name is only shown to you and on the consent screen you'll see when authorizing, not published anywhere.
4. If asked to associate a business portfolio, you can create one for Buy Sell Home Team | RE/MAX Results, or skip this if the option doesn't appear — the Instagram Login flow this guide uses does not require a Business Portfolio the way the Page-based flow would have.

## Step 3: Add the Instagram product

1. From your new app's dashboard, click **Add Product**, find **Instagram**, click **Set Up**.
2. That's the only product this server needs. You do **not** need to add Facebook Login for Business, Marketing API, WhatsApp, Messenger, or any ads-related product for v1's read-only scope.

## Step 4: Configure Instagram Business Login

1. In the left sidebar, under the **Instagram** product, find **Business Login** (sometimes labeled **API setup with Instagram login**).
2. Under **Redirect URIs** (or **Valid OAuth Redirect URIs**), add:
   ```
   http://localhost:8734/callback
   ```
   This is the URI the local `npm run token:authorize` helper script (bundled with this project) listens on. It only runs on your own machine for a few seconds while you authorize — Meta never sends anything to a public server. If you deploy this project remotely later and want to re-authorize without a local machine, you'd add that deployment's own callback URL here too — not required for v1.
3. Note the **authorization URL** the Dashboard shows you for this configuration. It should be on `instagram.com` (this guide and the authorize script assume `https://www.instagram.com/oauth/authorize`) — if the Dashboard shows a different domain, use the one the Dashboard gives you; Meta has changed this URL before.
4. Under permissions, select the ones listed in Step 5 below (the Dashboard may call this a "Business Login configuration" step).

## Step 5: Permissions this server's v1 tools need

Every V1 tool is read-only. Here's exactly what each needs:

| Permission                           | Used by                                                                                       | Notes                                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `instagram_business_basic`           | `meta_get_account`, `instagram_get_profile`, `instagram_list_media`, `instagram_get_mentions` | Basic profile/media read access                                                                                                       |
| `instagram_business_manage_insights` | `instagram_get_media_insights`, `instagram_get_account_insights`                              | Despite the name, this is the only scope Meta offers for reading Instagram insights — there is no separate "read-only insights" scope |
| `instagram_business_manage_comments` | `instagram_list_comments`, `instagram_get_mentions`                                           | Despite the name, this is also the only scope for reading comments — this server never uses it to post/delete                         |

These `instagram_business_*` names are specific to the Instagram Login flow this guide uses. (If you see permissions named just `instagram_basic`, `instagram_manage_insights`, etc. without the `business_` prefix in older tutorials, those belong to the different Facebook-Login-for-Business flow this project no longer uses — see [SECURITY.md](SECURITY.md#account-architecture-correction).)

You do not need `instagram_business_content_publish` or `instagram_business_manage_messages` for v1 — those are for publishing and DMs, which are part of the disabled future write layer (see [SECURITY.md](SECURITY.md)).

### Do you need App Review?

**No — not for this v1 setup.** App Review (and the "Advanced Access" tier it grants) is only required when your app will be used by Instagram accounts you don't own or manage — i.e. other people installing your app. Since this server only ever accesses **your own** Instagram account, and you are an admin/developer on the app itself, Meta grants **Standard Access** automatically, and the app can stay in **Development Mode** indefinitely.

Practical implication: as long as you are added as a **Developer**, **Admin**, or **Tester** on this app (App Dashboard → App Roles), every permission above works in Development Mode with no review, no waiting period, and no business verification.

### Do you need Business Verification?

**Not for v1, in the common case.** Business Verification becomes a requirement when an app requests **Advanced Access** to certain permissions (which you won't be requesting, per above) or when Meta's automated risk checks flag the app for other reasons — this can happen even to small self-use apps occasionally, and if it does, the App Dashboard will tell you exactly what's needed and walk you through it. If you later want to expand this app beyond your own account, plan on completing Business Verification at that time.

### Development Mode limitations (which don't matter for v1, but good to know)

- Only people with a role on the app (Developer/Admin/Tester) can authorize it and use its tokens. That's fine here since it's just you.
- The app is not discoverable or usable by the public — which is exactly what you want for a private integration.
- If Meta ever prompts you to "go Live," you do not need to for this server to keep working for your own account.

## Step 6: Get your App ID and App Secret

1. In the App Dashboard, go to **App Settings → Basic**.
2. Copy the **App ID** and click **Show** next to **App Secret** (you may need to re-enter your Facebook password).
3. Put both into your local `.env` file (copy `.env.example` to `.env` first if you haven't):
   ```
   META_APP_ID=your-app-id
   META_APP_SECRET=your-app-secret
   ```
   **Never share the App Secret, paste it into a chat, or commit it to any code repository.** Treat it like a master password for the app.

## Getting your access token

This project includes a script that does the OAuth flow for you and prints out the values you need.

1. Make sure `META_APP_ID` and `META_APP_SECRET` are set in `.env` (Step 6).
2. Run:
   ```
   npm run token:authorize
   ```
3. The script prints a URL on `instagram.com`. Open it in a browser where you're logged into Blaise's Instagram account and approve the requested permissions (the same list from Step 5).
4. The browser redirects to `localhost:8734` (the script is listening locally for this) and the terminal prints your `META_IG_ACCESS_TOKEN` and `META_IG_USER_ID`, along with the account's username as a sanity check.
5. Copy those two values into `.env`.

Under the hood this does what Meta's docs describe for Instagram Login: authorize on instagram.com → get a short-lived token (which also hands back the Instagram Business Account ID directly, as `user_id` — no Page lookup needed) → exchange it for a **long-lived token (~60 days)** via `graph.instagram.com/access_token` with `grant_type=ig_exchange_token`.

### Token refresh

Instagram User Access Tokens obtained this way last about 60 days. This server does not auto-refresh them (that would mean storing your App Secret on a running server, which is unnecessary risk for a personal integration — see [docs/SECURITY.md](SECURITY.md)). Instead:

- Re-run `npm run token:authorize` before the 60 days are up (Meta doesn't send a warning — plan to redo this roughly every 6–8 weeks, or set yourself a recurring reminder).
- If a tool call ever returns "token expired," that's your sign to re-run it immediately.

## Facebook Professional Mode

This is the account-architecture correction this guide was rewritten for, spelled out in full.

**What Blaise actually has**: one personal Facebook profile with Professional Mode enabled — not a Facebook Page. Professional Mode is a content-discovery and monetization setting Meta added for individual creators; it changes what other people see and how your posts can be discovered, but it does not turn your profile into a Page.

**What this means for the API**: Meta's Graph API has read/write access to Facebook **Pages** — posts, comments, insights, publishing — and has not exposed an equivalent for personal profiles (Professional Mode or otherwise) since Meta locked down personal-profile API access in 2018 for privacy reasons. There is no documented "Professional Mode API." Concretely:

- `facebook_get_page`, `facebook_list_posts`, and `facebook_get_post_insights` (this project's three Facebook tools) all require a real Facebook Page ID and a Page Access Token — they cannot be pointed at a personal profile, Professional Mode or not.
- Because of that, this server treats them as an **optional module, disabled by default** (`ENABLE_FACEBOOK_PAGE_MODULE=false` in `.env.example`). They stay fully implemented in the codebase but are not registered — Claude cannot see or call them — unless you explicitly enable the module.
- Instagram functionality is completely unaffected: every Instagram tool works from Blaise's Instagram account alone, with no Facebook Page dependency at all (that's the whole point of the Instagram Login flow this guide now uses).

**If Blaise later creates and connects an actual Facebook Page** (e.g. for the business), enabling the Facebook Page tools would require:

1. Creating a Facebook Page (Meta Business Suite → Create Page, or facebook.com/pages/create).
2. Adding the **Facebook Login for Business** product to this same Meta app (or a separate one).
3. A separate OAuth flow against that product to get a Page Access Token (the `pages_show_list`, `pages_read_engagement`, `pages_read_user_content` permissions this project's docs described in an earlier version) — `scripts/authorize.ts` in its current form does not perform this; it would need to be extended or run alongside a second script.
4. Setting `ENABLE_FACEBOOK_PAGE_MODULE=true`, `META_PAGE_ACCESS_TOKEN`, and `META_PAGE_ID` in `.env`.

None of this is needed to use the Instagram tools, and nothing above should be done speculatively — only if Blaise decides he wants a Page for its own sake.

## Troubleshooting

- **"Invalid OAuth redirect URI"** during authorization — the URI in your browser doesn't exactly match what's in Step 4.2. It must be `http://localhost:8734/callback` exactly (or match whatever `AUTHORIZE_PORT` you set).
- **The authorize.ts script's instagram.com URL 404s or looks wrong** — Meta has changed this domain before. Check the exact "Authorization window" URL your App Dashboard's Instagram → Business Login page shows for your app and use that instead; it should still accept the same `client_id`/`redirect_uri`/`scope`/`response_type=code` query parameters.
- **No Instagram account / wrong account after authorizing** — confirm you logged into instagram.com with the account you intend to connect, and that it's a Professional (Business or Creator) account, not personal.
- **Permission errors from a tool** even though setup looked right — double check every permission in the Step 5 table was included in your Business Login configuration, then re-run `npm run token:authorize` (tokens only carry the permissions that were actually granted at authorization time).
- **"No Facebook Page" errors** — you shouldn't see any; this server's Instagram tools never look for a Page. If you do see one, you may be running an older build — check you're on the current `main`/PR branch.
