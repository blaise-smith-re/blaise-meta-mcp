#!/usr/bin/env node
/**
 * One-time local helper that walks Blaise through Meta's "Instagram API
 * with Instagram Login" OAuth flow and prints the long-lived Instagram User
 * Access Token to paste into .env.
 *
 * This flow — not Facebook Login for Business — is what matches Blaise's
 * actual account: an Instagram Professional account linked only to his
 * personal Facebook profile's Accounts Center, with no separate Facebook
 * Page. See docs/META_SETUP.md for the full explanation. Concretely, that
 * means: the authorize screen is on instagram.com (not facebook.com), the
 * token exchange goes to api.instagram.com / graph.instagram.com (not
 * graph.facebook.com), and there is no Page to look up afterward — Meta
 * hands back the Instagram Business Account ID directly as `user_id`.
 *
 * This is intentionally a standalone script, not part of the running
 * server: the server itself never performs OAuth — it only ever reads an
 * already-minted token from META_IG_ACCESS_TOKEN. Keeping token
 * acquisition out of the deployed server means a compromised deployment
 * never has the app secret or the ability to mint new tokens.
 *
 * Usage (run locally, not on a shared/remote machine):
 *   META_APP_ID=... META_APP_SECRET=... npm run token:authorize
 *
 * Requires that http://localhost:8734/callback (or your AUTHORIZE_PORT) is
 * added under the Instagram product's "Business Login" > Redirect URIs in
 * the Meta App Dashboard first. See docs/META_SETUP.md.
 */
import "dotenv/config";
import { createServer } from "node:http";
import { DEFAULT_GRAPH_API_VERSION } from "../src/constants.js";

const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;
const GRAPH_VERSION = process.env.GRAPH_API_VERSION || DEFAULT_GRAPH_API_VERSION;
const PORT = Number(process.env.AUTHORIZE_PORT || 8734);
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

// Only the permissions V1 read-only tools need. Keep this list in sync with
// docs/META_SETUP.md if it changes. These instagram_business_* names are
// specific to the Instagram Login flow this script uses — don't confuse
// them with the differently-named Facebook-Login-for-Business scopes.
const SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_insights",
  "instagram_business_manage_comments",
];

function fail(message: string): never {
  console.error(`\nError: ${message}\n`);
  process.exit(1);
}

if (!APP_ID || !APP_SECRET) {
  fail(
    "META_APP_ID and META_APP_SECRET must be set (in your shell or .env) before running this script.\n" +
      "These come from your Meta App Dashboard > App Settings > Basic. See docs/META_SETUP.md.",
  );
}

interface ShortLivedTokenResponse {
  access_token?: string;
  user_id?: number | string;
  permissions?: string[];
  error_type?: string;
  error_message?: string;
}

interface LongLivedTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message: string };
}

interface IgProfileResponse {
  id?: string;
  username?: string;
  name?: string;
  account_type?: string;
  error?: { message: string };
}

async function exchangeCodeForToken(
  code: string,
): Promise<{ accessToken: string; userId: string }> {
  const body = new URLSearchParams({
    client_id: APP_ID!,
    client_secret: APP_SECRET!,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
    code,
  });

  const res = (await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  }).then((r) => r.json())) as ShortLivedTokenResponse;

  if (!res.access_token || res.user_id === undefined) {
    fail(`Short-lived token exchange failed: ${res.error_message ?? "unknown error"}`);
  }
  return { accessToken: res.access_token, userId: String(res.user_id) };
}

async function exchangeForLongLivedToken(shortLivedToken: string): Promise<string> {
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", APP_SECRET!);
  url.searchParams.set("access_token", shortLivedToken);

  const res = (await fetch(url).then((r) => r.json())) as LongLivedTokenResponse;
  if (!res.access_token) {
    fail(`Long-lived token exchange failed: ${res.error?.message ?? "unknown error"}`);
  }
  return res.access_token;
}

async function fetchProfile(userId: string, accessToken: string): Promise<IgProfileResponse> {
  const url = new URL(`https://graph.instagram.com/${GRAPH_VERSION}/${userId}`);
  url.searchParams.set("fields", "id,username,name,account_type");
  url.searchParams.set("access_token", accessToken);

  const res = (await fetch(url).then((r) => r.json())) as IgProfileResponse;
  if (res.error) fail(`Fetching profile failed: ${res.error.message}`);
  return res;
}

async function main(): Promise<void> {
  const authorizeUrl = new URL("https://www.instagram.com/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", APP_ID!);
  authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authorizeUrl.searchParams.set("scope", SCOPES.join(","));
  authorizeUrl.searchParams.set("response_type", "code");

  console.log("\n1. Open this URL in the browser where you're logged into Blaise's Instagram");
  console.log("   account, and approve the requested permissions:\n");
  console.log(`   ${authorizeUrl.toString()}\n`);
  console.log(`2. Waiting for the redirect back to ${REDIRECT_URI} ...\n`);
  console.log(
    "   (If this exact URL 404s or Meta rejects it, your App Dashboard may still expose the\n" +
      "   older api.instagram.com/oauth/authorize domain for this step instead — check the\n" +
      "   Instagram product's Business Login page in the Dashboard for the exact URL it gives you.)\n",
  );

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      const errorDescription = url.searchParams.get("error_description");
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        errorDescription
          ? `<p>Authorization failed: ${errorDescription}. You can close this tab.</p>`
          : "<p>Authorization received. You can close this tab and return to the terminal.</p>",
      );
      server.close();
      if (code) resolve(code);
      else reject(new Error(errorDescription ?? "No authorization code returned"));
    });
    server.listen(PORT);
  });

  console.log("3. Exchanging the authorization code for a token...");
  const { accessToken: shortLived, userId } = await exchangeCodeForToken(code);

  console.log("4. Exchanging for a long-lived (~60 day) token...");
  const longLived = await exchangeForLongLivedToken(shortLived);

  console.log("5. Confirming the connected Instagram account...\n");
  const profile = await fetchProfile(userId, longLived);

  console.log("=".repeat(72));
  console.log("SUCCESS — copy the values below into your .env file, then close this");
  console.log("terminal or clear its scrollback. Do not paste this output anywhere else.");
  console.log("=".repeat(72));
  console.log(
    `\nInstagram account: ${profile.name ?? ""} @${profile.username ?? "?"} (${profile.account_type ?? "?"})`,
  );
  console.log(`  META_IG_ACCESS_TOKEN=${longLived}`);
  console.log(`  META_IG_USER_ID=${userId}`);
  console.log("\nNote: this token lasts ~60 days. Re-run this script to refresh it before it");
  console.log("expires — see docs/META_SETUP.md.\n");
  console.log(
    "If Blaise later creates an actual Facebook Page and wants the optional Facebook Page\n" +
      "module (facebook_get_page / facebook_list_posts / facebook_get_post_insights), that\n" +
      "requires a separate Facebook Login for Business authorization this script does not\n" +
      "perform — see docs/META_SETUP.md#facebook-professional-mode for what that would involve.\n",
  );
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
