import type { AppConfig } from "../config.js";

export type WriteActionFlag =
  "allowInstagramPublish" | "allowFacebookPublish" | "allowCommentReplies" | "allowMessageReplies";

/**
 * The single gate every future write action must pass through. V1 ships
 * read-only: ENABLE_WRITE_ACTIONS defaults to false, so this always throws
 * today. It exists so the write layer can be architected (tool shape, input
 * schemas, permission notes) without ever being reachable until Blaise
 * explicitly opts in per-action in his environment.
 */
export class WriteActionsDisabledError extends Error {
  constructor(action: string, reason: string) {
    super(`Write action "${action}" is disabled: ${reason}`);
    this.name = "WriteActionsDisabledError";
  }
}

export function assertWriteActionAllowed(
  config: AppConfig,
  action: string,
  flag: WriteActionFlag,
): void {
  if (!config.writeActions.enabled) {
    throw new WriteActionsDisabledError(
      action,
      "ENABLE_WRITE_ACTIONS is not set to true. This server is running in read-only mode by design.",
    );
  }
  if (!config.writeActions[flag]) {
    throw new WriteActionsDisabledError(
      action,
      `ENABLE_WRITE_ACTIONS is true but ${flagEnvName(flag)} is not — enable it explicitly to allow this specific action.`,
    );
  }
}

function flagEnvName(flag: WriteActionFlag): string {
  const map: Record<WriteActionFlag, string> = {
    allowInstagramPublish: "ALLOW_INSTAGRAM_PUBLISH",
    allowFacebookPublish: "ALLOW_FACEBOOK_PUBLISH",
    allowCommentReplies: "ALLOW_COMMENT_REPLIES",
    allowMessageReplies: "ALLOW_MESSAGE_REPLIES",
  };
  return map[flag];
}
