# Meta Developer Setup Guide

This walks you (Blaise) through creating and configuring the Meta app this server needs. You do not need to write any code. It should take 30–45 minutes.

**Meta redesigns its Developer Dashboard periodically**, so a button or menu label below might have moved slightly by the time you do this. If something doesn't match exactly, look for the nearest equivalent — the underlying steps (create app → add products → configure permissions → generate token) don't change often. When in doubt, the authoritative source is [developers.facebook.com/docs/instagram-platform](https://developers.facebook.com/docs/instagram-platform/).

## Before you start: prerequisites

1. **Your Instagram account must be a Professional account** (Business or Creator), not a personal account.
   - In the Instagram app: Settings → Account type and tools → Switch to Professional Account.
2. **That Instagram account must be linked to a Facebook Page you administer** — the Buy Sell Home Team Page.
   - In the Instagram app: Settings → Account Center → Connected experiences → Sharing to other profiles, or link it from Meta Business Suite. If you're not sure it's linked, Meta Business Suite (business.facebook.com) will show both under the same account and let you connect them if not.
3. **You must be an admin of the Facebook Page** with your personal Facebook account.

If any of these aren't true yet, fix them first — nothing below will work without them.

## Step 1: Create a Meta Developer account

1. Go to [developers.facebook.com](https://developers.facebook.com) and log in with the Facebook account that administers your Page.
2. If you've never used the Developer site before, you'll be prompted to register as a developer (accept the terms, verify your account — sometimes by phone/email).

## Step 2: Create the app

1. From the Developer Dashboard, click **My Apps** → **Create App**.
2. Meta will ask what you're building. Choose the **Business** app type — this is the type that supports the Instagram + Facebook Page permissions this server needs.
3. Give it a name (e.g. "Blaise Meta MCP" or "Buy Sell Home Team Integration") — this name is only shown to you and to the login/consent screen you'll see when authorizing, not published anywhere.
4. When asked which business portfolio to associate it with, choose or create a Business Portfolio (formerly "Business Manager") for Buy Sell Home Team | RE/MAX Results if you have one, or create a new one. Associating the app with your business is what lets it manage your Page/Instagram assets and is generally required before you can add the login products below.

## Step 3: Add the products this server needs

From your new app's dashboard, you'll add products (Meta's term for API capability bundles):

1. **Instagram** — click **Add Product**, find **Instagram**, click **Set Up**. This gives you the Instagram Graph API surface.
2. **Facebook Login for Business** — add this product too. Because Blaise's Instagram account is linked to a Facebook Page (rather than standalone), authorization goes through Facebook Login for Business: the token you end up with is a **Page Access Token**, and Meta reads/writes the linked Instagram account through that same Page token. This matches how this server is built (see `src/meta/account.ts`).

You do not need Marketing API, WhatsApp, Messenger, or any ads-related product for this server's v1 (read-only, non-advertising) scope.

## Step 4: Configure Facebook Login for Business

1. In the left sidebar, under **Facebook Login for Business**, go to **Settings** (or **Configurations**, depending on dashboard version).
2. Under **Valid OAuth Redirect URIs**, add:
   ```
   http://localhost:8734/callback
   ```
   This is the URI the local `npm run token:authorize` helper script (bundled with this project) listens on. It only runs on your own machine for a few seconds while you authorize — Meta never sends anything to a public server. If you deploy this project remotely later and want the ability to re-authorize without a local machine, you'd add that deployment's own callback URL here too — that's not required for v1.
3. If prompted to create a **Login Configuration**: create one, and under permissions, select the ones listed in Step 5 below. Save it.

## Step 5: Permissions this server's v1 tools need

Every V1 tool is read-only. Here's exactly what each needs:

| Permission                  | Used by                                                                                       | Notes                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `instagram_basic`           | `meta_get_account`, `instagram_get_profile`, `instagram_list_media`, `instagram_get_mentions` | Basic profile/media read access                                                                                                       |
| `instagram_manage_insights` | `instagram_get_media_insights`, `instagram_get_account_insights`                              | Despite the name, this is the only scope Meta offers for reading Instagram insights — there is no separate "read-only insights" scope |
| `instagram_manage_comments` | `instagram_list_comments`, `instagram_get_mentions`                                           | Despite the name, this is also the only scope for reading comments — this server never uses it to post/delete                         |
| `pages_show_list`           | `meta_get_account`                                                                            | Lets the app see which Pages you manage                                                                                               |
| `pages_read_engagement`     | `facebook_get_page`, `facebook_list_posts`, `facebook_get_post_insights`                      | Page content + engagement counts                                                                                                      |
| `pages_read_user_content`   | `facebook_get_post_insights`                                                                  | Some Page post/engagement breakdowns require this alongside `pages_read_engagement`                                                   |
| `business_management`       | Account/Page resolution when assets sit inside a Business Portfolio                           | Only needed if your Page is managed through a Business Portfolio, which it likely is after Step 2                                     |

Add all of these to your Login Configuration (Step 4.3) or, if your dashboard instead lets you request them per-product under **Instagram → API Setup**, add them there.

### A note on permission naming

If you search around or watch tutorials, you may see a _different_ set of Instagram permission names with a `instagram_business_` prefix (e.g. `instagram_business_basic`, `instagram_business_manage_comments`). **Those are not a newer version of the permissions in the table above — they belong to a different Meta login flow** ("Instagram API with Instagram Login," for Instagram accounts that are _not_ linked to a Facebook Page). Meta renamed that flow's permissions in January 2025; the permissions in the table above belong to "Instagram API with Facebook Login for Business" (the flow this server uses, because your Instagram account is linked to a Facebook Page) and were not part of that rename. If the App Dashboard's permission picker ever shows you both families, use the plain names from the table above, not the `instagram_business_*` ones.

(This project's own research access to Meta's live documentation was network-restricted while writing this guide, so this is based on cross-referencing several independent, dated third-party developer sources rather than a single authoritative page — if the App Dashboard's permission picker shows something that doesn't match this table when you get there, trust the Dashboard and let that override this doc.)

### Do you need App Review?

**No — not for this v1 setup.** App Review (and the "Advanced Access" tier it grants) is only required when your app will be used by Instagram/Facebook accounts you don't own or manage — i.e. other businesses installing your app. Since this server only ever accesses **your own** Page and Instagram account, and you are an admin/developer on the app itself, Meta grants **Standard Access** automatically, and the app can stay in **Development Mode** indefinitely.

Practical implication: as long as you (the Facebook account that owns the Page) are added as a **Developer**, **Admin**, or **Tester** on this app (App Dashboard → App Roles), every permission above works in Development Mode with no review, no waiting period, and no business verification.

### Do you need Business Verification?

**Not for v1, in the common case.** Business Verification becomes a requirement when an app requests **Advanced Access** to certain permissions (which you won't be requesting, per above) or when Meta's automated risk checks flag the app for other reasons — this can happen even to small self-use apps occasionally, and if it does, the App Dashboard will tell you exactly what's needed and walk you through it (typically: business name, address, a document like an EIN letter or business license, an authorized-representative confirmation). If you later want to expand this app beyond your own account, plan on completing Business Verification at that time.

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
3. The script prints a URL. Open it in a browser where you're logged into the Facebook account that administers the Page. Approve the requested permissions (the same list from Step 5) and select the Buy Sell Home Team Page when Meta asks which Page/assets to share.
4. The browser redirects to `localhost:8734` (the script is listening locally for this) and the terminal prints your `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, and `META_IG_USER_ID`.
5. Copy those three values into `.env`.

Under the hood this does what Meta's docs describe as the standard flow: authorize → get a short-lived token → exchange it for a **long-lived token (~60 days)** via the `/oauth/access_token` endpoint with `grant_type=fb_exchange_token` → look up your Pages via `/me/accounts`, which returns a Page Access Token that inherits the long-lived token's expiry.

### Token refresh

Page Access Tokens obtained this way last about 60 days. This server does not auto-refresh them (that would mean storing your App Secret on a running server, which is unnecessary risk for a personal integration — see [docs/SECURITY.md](SECURITY.md)). Instead:

- Re-run `npm run token:authorize` before the 60 days are up (Meta doesn't send a warning — plan to redo this roughly every 6–8 weeks, or set yourself a recurring reminder).
- If a tool call ever returns "token expired," that's your sign to re-run it immediately.

## Troubleshooting

- **"Invalid OAuth redirect URI"** during authorization — the URI in your browser doesn't exactly match what's in Step 4.2. It must be `http://localhost:8734/callback` exactly (or match whatever `AUTHORIZE_PORT` you set).
- **No Pages returned** by the authorize script — confirm the Facebook account you logged in with is an admin of the Page, and that you approved the Page-selection step during authorization (Meta sometimes shows a separate "which Pages/assets to share" screen after the main permissions screen).
- **No Instagram account found** for the Page — confirm the Instagram account is a Professional account and is linked to that specific Page (Meta Business Suite → Settings → Linked accounts).
- **Permission errors from a tool** even though setup looked right — double check every permission in the Step 5 table was included in your Login Configuration, then re-run `npm run token:authorize` (tokens only carry the permissions that were actually granted at authorization time).
