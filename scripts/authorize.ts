#!/usr/bin/env node
/**
 * One-time local helper that walks Blaise through Meta's OAuth flow and
 * prints the long-lived Page Access Token to paste into .env.
 *
 * This is intentionally a standalone script, not part of the running
 * server: the server itself never performs OAuth — it only ever reads an
 * already-minted token from META_PAGE_ACCESS_TOKEN. Keeping token
 * acquisition out of the deployed server means a compromised deployment
 * never has the app secret or the ability to mint new tokens.
 *
 * Usage (run locally, not on a shared/remote machine):
 *   META_APP_ID=... META_APP_SECRET=... npm run token:authorize
 *
 * Requires that http://localhost:8734/callback (or your AUTHORIZE_PORT) is
 * added under "Valid OAuth Redirect URIs" in the Meta App Dashboard first.
 * See docs/META_SETUP.md.
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
// docs/META_SETUP.md if it changes.
const SCOPES = [
  "instagram_basic",
  "instagram_manage_insights",
  "instagram_manage_comments",
  "pages_show_list",
  "pages_read_engagement",
  "pages_read_user_content",
  "business_management",
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

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: { message: string };
}

interface AccountsResponse {
  data?: {
    id: string;
    name: string;
    access_token: string;
    instagram_business_account?: { id: string; username?: string };
  }[];
  error?: { message: string };
}

async function exchangeCodeForToken(code: string): Promise<string> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
  url.searchParams.set("client_id", APP_ID!);
  url.searchParams.set("client_secret", APP_SECRET!);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("code", code);

  const res = (await fetch(url).then((r) => r.json())) as TokenResponse;
  if (!res.access_token)
    fail(`Short-lived token exchange failed: ${res.error?.message ?? "unknown error"}`);
  return res.access_token;
}

async function exchangeForLongLivedToken(shortLivedToken: string): Promise<string> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", APP_ID!);
  url.searchParams.set("client_secret", APP_SECRET!);
  url.searchParams.set("fb_exchange_token", shortLivedToken);

  const res = (await fetch(url).then((r) => r.json())) as TokenResponse;
  if (!res.access_token)
    fail(`Long-lived token exchange failed: ${res.error?.message ?? "unknown error"}`);
  return res.access_token;
}

async function listPagesWithInstagram(
  longLivedUserToken: string,
): Promise<AccountsResponse["data"]> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token,instagram_business_account{id,username}");
  url.searchParams.set("access_token", longLivedUserToken);

  const res = (await fetch(url).then((r) => r.json())) as AccountsResponse;
  if (res.error) fail(`Fetching Pages failed: ${res.error.message}`);
  return res.data ?? [];
}

async function main(): Promise<void> {
  const authorizeUrl = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  authorizeUrl.searchParams.set("client_id", APP_ID!);
  authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authorizeUrl.searchParams.set("scope", SCOPES.join(","));
  authorizeUrl.searchParams.set("response_type", "code");

  console.log(
    "\n1. Open this URL in the browser where you're logged into the Facebook account that",
  );
  console.log("   manages Blaise's Page, and approve the requested permissions:\n");
  console.log(`   ${authorizeUrl.toString()}\n`);
  console.log(`2. Waiting for the redirect back to ${REDIRECT_URI} ...\n`);

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
  const shortLived = await exchangeCodeForToken(code);

  console.log("4. Exchanging for a long-lived (~60 day) token...");
  const longLived = await exchangeForLongLivedToken(shortLived);

  console.log("5. Looking up connected Facebook Pages and linked Instagram accounts...\n");
  const pages = await listPagesWithInstagram(longLived);

  if (!pages || pages.length === 0) {
    fail(
      "No Facebook Pages were returned for this account. Confirm the logged-in user is an admin of " +
        "the Page, and that pages_show_list was granted during authorization.",
    );
  }

  console.log("=".repeat(72));
  console.log("SUCCESS — copy the values below into your .env file, then close this");
  console.log("terminal or clear its scrollback. Do not paste this output anywhere else.");
  console.log("=".repeat(72));
  for (const page of pages!) {
    console.log(`\nPage: ${page.name}`);
    console.log(`  META_PAGE_ID=${page.id}`);
    console.log(`  META_PAGE_ACCESS_TOKEN=${page.access_token}`);
    if (page.instagram_business_account) {
      console.log(
        `  META_IG_USER_ID=${page.instagram_business_account.id}  # @${page.instagram_business_account.username ?? "?"}`,
      );
    } else {
      console.log("  (No Instagram Professional account linked to this Page.)");
    }
  }
  console.log("\nNote: the Page access token above inherits the long-lived user token's ~60 day");
  console.log(
    "lifetime. Re-run this script to refresh it before it expires — see docs/META_SETUP.md.\n",
  );
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
