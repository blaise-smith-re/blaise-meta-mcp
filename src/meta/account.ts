import type { AppConfig } from "../config.js";

/**
 * Returns the configured Instagram Business Account ID.
 *
 * There is no Page to traverse to discover this anymore ("Instagram API
 * with Instagram Login" doesn't involve a Facebook Page at all — see
 * docs/META_SETUP.md) — Meta hands the account's numeric ID back directly
 * during the OAuth token exchange (as `user_id`), which `npm run
 * token:authorize` captures and prints for `.env`. Config validation
 * (src/config.ts) already guarantees META_IG_USER_ID is set, so this is a
 * plain accessor, not a network call.
 */
export function getIgUserId(config: AppConfig): string {
  return config.metaIgUserId;
}
