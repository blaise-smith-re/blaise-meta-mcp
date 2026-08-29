import type { AppConfig } from "../config.js";
import type { MetaGraphClient } from "./client.js";

export interface ResolvedAccount {
  page: {
    id: string;
    name: string;
    username?: string;
    category?: string;
  };
  instagram?: {
    id: string;
    username?: string;
    name?: string;
    accountType?: string;
  };
}

interface PageWithIgFields {
  id: string;
  name: string;
  username?: string;
  category?: string;
  instagram_business_account?: {
    id: string;
    username?: string;
    name?: string;
    // "account_type" is not returned on the nested instagram_business_account
    // edge by every API version; fetched separately when present.
  };
}

let cachedIgUserId: string | undefined;

/**
 * Resolves the Facebook Page and its linked Instagram Professional account.
 * This is the one place that discovers the Instagram Business Account ID
 * when META_IG_USER_ID isn't set in the environment — the result is cached
 * in-process so repeated tool calls don't re-fetch it every time.
 */
export async function resolveAccount(
  client: MetaGraphClient,
  config: AppConfig,
): Promise<ResolvedAccount> {
  const page = await client.get<PageWithIgFields>(config.metaPageId, {
    fields: "id,name,username,category,instagram_business_account{id,username,name}",
  });

  const igUserId = config.metaIgUserId ?? page.instagram_business_account?.id;
  if (igUserId) cachedIgUserId = igUserId;

  return {
    page: {
      id: page.id,
      name: page.name,
      username: page.username,
      category: page.category,
    },
    instagram: page.instagram_business_account
      ? {
          id: page.instagram_business_account.id,
          username: page.instagram_business_account.username,
          name: page.instagram_business_account.name,
        }
      : config.metaIgUserId
        ? { id: config.metaIgUserId }
        : undefined,
  };
}

/**
 * Returns the Instagram Business Account ID, using META_IG_USER_ID if set,
 * otherwise resolving (and caching) it from the connected Facebook Page.
 */
export async function getIgUserId(client: MetaGraphClient, config: AppConfig): Promise<string> {
  if (config.metaIgUserId) return config.metaIgUserId;
  if (cachedIgUserId) return cachedIgUserId;

  const account = await resolveAccount(client, config);
  if (!account.instagram?.id) {
    throw new Error(
      "No Instagram Professional account is linked to the configured Facebook Page " +
        `(META_PAGE_ID=${config.metaPageId}). Link the Instagram account to the Page in ` +
        "Meta Business Suite, or set META_IG_USER_ID explicitly.",
    );
  }
  return account.instagram.id;
}

/** Test-only: reset the in-process IG user id cache between test cases. */
export function clearAccountCache(): void {
  cachedIgUserId = undefined;
}
