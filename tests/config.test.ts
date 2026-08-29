import { describe, expect, it } from "vitest";
import { ConfigValidationError, loadConfig, secretsOf } from "../src/config.js";

const validEnv = {
  META_PAGE_ACCESS_TOKEN: "A".repeat(40),
  META_PAGE_ID: "1234567890",
};

describe("loadConfig", () => {
  it("loads a minimal valid environment with sane defaults", () => {
    const config = loadConfig(validEnv as NodeJS.ProcessEnv);
    expect(config.metaPageId).toBe("1234567890");
    expect(config.transport).toBe("stdio");
    expect(config.graphApiVersion).toMatch(/^v\d+\.\d+$/);
    expect(config.writeActions.enabled).toBe(false);
    expect(config.writeActions.allowInstagramPublish).toBe(false);
    expect(config.writeActions.allowFacebookPublish).toBe(false);
    expect(config.writeActions.allowCommentReplies).toBe(false);
    expect(config.writeActions.allowMessageReplies).toBe(false);
  });

  it("throws ConfigValidationError when META_PAGE_ACCESS_TOKEN is missing", () => {
    const env = { META_PAGE_ID: "123" };
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(ConfigValidationError);
  });

  it("throws ConfigValidationError when META_PAGE_ID is missing", () => {
    const env = { META_PAGE_ACCESS_TOKEN: "A".repeat(40) };
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(ConfigValidationError);
  });

  it("rejects an access token that is too short to be real", () => {
    const env = { ...validEnv, META_PAGE_ACCESS_TOKEN: "short" };
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(ConfigValidationError);
  });

  it("requires MCP_SERVER_AUTH_TOKEN when TRANSPORT=http", () => {
    const env = { ...validEnv, TRANSPORT: "http" };
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(ConfigValidationError);
  });

  it("accepts TRANSPORT=http when MCP_SERVER_AUTH_TOKEN is set", () => {
    const env = { ...validEnv, TRANSPORT: "http", MCP_SERVER_AUTH_TOKEN: "B".repeat(20) };
    const config = loadConfig(env as NodeJS.ProcessEnv);
    expect(config.transport).toBe("http");
    expect(config.mcpServerAuthToken).toBe("B".repeat(20));
  });

  it("parses write-action flags from string env values", () => {
    const env = {
      ...validEnv,
      ENABLE_WRITE_ACTIONS: "true",
      ALLOW_INSTAGRAM_PUBLISH: "true",
      ALLOW_FACEBOOK_PUBLISH: "false",
    };
    const config = loadConfig(env as NodeJS.ProcessEnv);
    expect(config.writeActions.enabled).toBe(true);
    expect(config.writeActions.allowInstagramPublish).toBe(true);
    expect(config.writeActions.allowFacebookPublish).toBe(false);
    expect(config.writeActions.allowCommentReplies).toBe(false);
  });

  it("reports every validation issue at once, not just the first", () => {
    try {
      loadConfig({} as NodeJS.ProcessEnv);
      expect.unreachable("loadConfig should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      const message = (error as ConfigValidationError).message;
      expect(message).toContain("META_PAGE_ACCESS_TOKEN");
      expect(message).toContain("META_PAGE_ID");
    }
  });
});

describe("secretsOf", () => {
  it("collects every secret-shaped config value, omitting unset ones", () => {
    const config = loadConfig(validEnv as NodeJS.ProcessEnv);
    const secrets = secretsOf(config);
    expect(secrets).toContain(config.metaPageAccessToken);
    expect(secrets).not.toContain(undefined);
  });

  it("includes the app secret and server auth token when present", () => {
    const env = {
      ...validEnv,
      META_APP_SECRET: "app-secret-value-1234567890",
      TRANSPORT: "http",
      MCP_SERVER_AUTH_TOKEN: "B".repeat(20),
    };
    const config = loadConfig(env as NodeJS.ProcessEnv);
    const secrets = secretsOf(config);
    expect(secrets).toContain("app-secret-value-1234567890");
    expect(secrets).toContain("B".repeat(20));
  });
});
