import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { assertWriteActionAllowed, WriteActionsDisabledError } from "../src/meta/writeGuard.js";

const baseEnv = {
  META_IG_ACCESS_TOKEN: "A".repeat(40),
  META_IG_USER_ID: "123",
};

describe("assertWriteActionAllowed", () => {
  it("throws when ENABLE_WRITE_ACTIONS is unset (the v1 default)", () => {
    const config = loadConfig(baseEnv as NodeJS.ProcessEnv);
    expect(() =>
      assertWriteActionAllowed(config, "instagram_publish_media", "allowInstagramPublish"),
    ).toThrow(WriteActionsDisabledError);
  });

  it("throws when ENABLE_WRITE_ACTIONS is true but the specific action flag is not", () => {
    const config = loadConfig({
      ...baseEnv,
      ENABLE_WRITE_ACTIONS: "true",
    } as NodeJS.ProcessEnv);
    expect(() =>
      assertWriteActionAllowed(config, "instagram_publish_media", "allowInstagramPublish"),
    ).toThrow(WriteActionsDisabledError);
  });

  it("does not throw once both the master switch and the specific flag are enabled", () => {
    const config = loadConfig({
      ...baseEnv,
      ENABLE_WRITE_ACTIONS: "true",
      ALLOW_INSTAGRAM_PUBLISH: "true",
    } as NodeJS.ProcessEnv);
    expect(() =>
      assertWriteActionAllowed(config, "instagram_publish_media", "allowInstagramPublish"),
    ).not.toThrow();
  });

  it("keeps other write actions disabled even when one is enabled", () => {
    const config = loadConfig({
      ...baseEnv,
      ENABLE_WRITE_ACTIONS: "true",
      ALLOW_INSTAGRAM_PUBLISH: "true",
    } as NodeJS.ProcessEnv);
    expect(() =>
      assertWriteActionAllowed(config, "facebook_publish_post", "allowFacebookPublish"),
    ).toThrow(WriteActionsDisabledError);
  });
});
