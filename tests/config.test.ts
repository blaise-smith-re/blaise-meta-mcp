import { describe, expect, it } from "vitest";
import { ConfigValidationError, loadConfig, secretsOf } from "../src/config.js";

const validEnv = {
  META_IG_ACCESS_TOKEN: "A".repeat(40),
  META_IG_USER_ID: "17841400000000000",
};

describe("loadConfig", () => {
  it("loads a minimal valid environment with sane defaults", () => {
    const config = loadConfig(validEnv as NodeJS.ProcessEnv);
    expect(config.metaIgUserId).toBe("17841400000000000");
    expect(config.transport).toBe("stdio");
    expect(config.graphApiVersion).toMatch(/^v\d+\.\d+$/);
    expect(config.facebookPage.enabled).toBe(false);
    expect(config.writeActions.enabled).toBe(false);
    expect(config.writeActions.allowInstagramPublish).toBe(false);
    expect(config.writeActions.allowFacebookPublish).toBe(false);
    expect(config.writeActions.allowCommentReplies).toBe(false);
    expect(config.writeActions.allowMessageReplies).toBe(false);
  });

  it("throws ConfigValidationError when META_IG_ACCESS_TOKEN is missing", () => {
    const env = { META_IG_USER_ID: "123" };
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(ConfigValidationError);
  });

  it("throws ConfigValidationError when META_IG_USER_ID is missing", () => {
    const env = { META_IG_ACCESS_TOKEN: "A".repeat(40) };
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(ConfigValidationError);
  });

  it("rejects an access token that is too short to be real", () => {
    const env = { ...validEnv, META_IG_ACCESS_TOKEN: "short" };
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(ConfigValidationError);
  });

  it("requires PUBLIC_URL and OAUTH_OWNER_PASSWORD when TRANSPORT=http", () => {
    const env = { ...validEnv, TRANSPORT: "http" };
    try {
      loadConfig(env as NodeJS.ProcessEnv);
      expect.unreachable("loadConfig should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      const message = (error as ConfigValidationError).message;
      expect(message).toContain("PUBLIC_URL");
      expect(message).toContain("OAUTH_OWNER_PASSWORD");
    }
  });

  it("rejects a non-HTTPS PUBLIC_URL that isn't localhost", () => {
    const env = {
      ...validEnv,
      TRANSPORT: "http",
      PUBLIC_URL: "http://example.com",
      OAUTH_OWNER_PASSWORD: "a-strong-owner-password",
    };
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(ConfigValidationError);
  });

  it("accepts a plain http:// PUBLIC_URL for localhost (local testing)", () => {
    const env = {
      ...validEnv,
      TRANSPORT: "http",
      PUBLIC_URL: "http://127.0.0.1:3000",
      OAUTH_OWNER_PASSWORD: "a-strong-owner-password",
    };
    const config = loadConfig(env as NodeJS.ProcessEnv);
    expect(config.publicUrl).toBe("http://127.0.0.1:3000");
  });

  it("accepts TRANSPORT=http once PUBLIC_URL and OAUTH_OWNER_PASSWORD are set", () => {
    const env = {
      ...validEnv,
      TRANSPORT: "http",
      PUBLIC_URL: "https://example.com",
      OAUTH_OWNER_PASSWORD: "a-strong-owner-password",
    };
    const config = loadConfig(env as NodeJS.ProcessEnv);
    expect(config.transport).toBe("http");
    expect(config.publicUrl).toBe("https://example.com");
    expect(config.oauthOwnerPassword).toBe("a-strong-owner-password");
  });

  it("keeps MCP_SERVER_AUTH_TOKEN optional even on TRANSPORT=http (OAuth is the primary path)", () => {
    const env = {
      ...validEnv,
      TRANSPORT: "http",
      PUBLIC_URL: "https://example.com",
      OAUTH_OWNER_PASSWORD: "a-strong-owner-password",
    };
    const config = loadConfig(env as NodeJS.ProcessEnv);
    expect(config.mcpServerAuthToken).toBeUndefined();
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
      expect(message).toContain("META_IG_ACCESS_TOKEN");
      expect(message).toContain("META_IG_USER_ID");
    }
  });

  describe("optional Facebook Page module", () => {
    it("leaves the module disabled by default, even with no Page vars set", () => {
      const config = loadConfig(validEnv as NodeJS.ProcessEnv);
      expect(config.facebookPage.enabled).toBe(false);
      expect(config.facebookPage.pageAccessToken).toBeUndefined();
      expect(config.facebookPage.pageId).toBeUndefined();
    });

    it("requires META_PAGE_ACCESS_TOKEN and META_PAGE_ID when ENABLE_FACEBOOK_PAGE_MODULE=true", () => {
      const env = { ...validEnv, ENABLE_FACEBOOK_PAGE_MODULE: "true" };
      try {
        loadConfig(env as NodeJS.ProcessEnv);
        expect.unreachable("loadConfig should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigValidationError);
        const message = (error as ConfigValidationError).message;
        expect(message).toContain("META_PAGE_ACCESS_TOKEN");
        expect(message).toContain("META_PAGE_ID");
      }
    });

    it("enables the module once both Page vars are set", () => {
      const env = {
        ...validEnv,
        ENABLE_FACEBOOK_PAGE_MODULE: "true",
        META_PAGE_ACCESS_TOKEN: "B".repeat(40),
        META_PAGE_ID: "9876543210",
      };
      const config = loadConfig(env as NodeJS.ProcessEnv);
      expect(config.facebookPage.enabled).toBe(true);
      expect(config.facebookPage.pageAccessToken).toBe("B".repeat(40));
      expect(config.facebookPage.pageId).toBe("9876543210");
    });

    it("does not require Page vars when the module flag is left unset", () => {
      expect(() => loadConfig(validEnv as NodeJS.ProcessEnv)).not.toThrow();
    });
  });
});

describe("secretsOf", () => {
  it("collects every secret-shaped config value, omitting unset ones", () => {
    const config = loadConfig(validEnv as NodeJS.ProcessEnv);
    const secrets = secretsOf(config);
    expect(secrets).toContain(config.metaIgAccessToken);
    expect(secrets).not.toContain(undefined);
  });

  it("includes the app secret, OAuth owner password, and legacy server auth token when present", () => {
    const env = {
      ...validEnv,
      META_APP_SECRET: "app-secret-value-1234567890",
      TRANSPORT: "http",
      PUBLIC_URL: "https://example.com",
      OAUTH_OWNER_PASSWORD: "a-strong-owner-password",
      MCP_SERVER_AUTH_TOKEN: "B".repeat(20),
    };
    const config = loadConfig(env as NodeJS.ProcessEnv);
    const secrets = secretsOf(config);
    expect(secrets).toContain("app-secret-value-1234567890");
    expect(secrets).toContain("a-strong-owner-password");
    expect(secrets).toContain("B".repeat(20));
  });

  it("includes the Facebook Page access token when the optional module is enabled", () => {
    const env = {
      ...validEnv,
      ENABLE_FACEBOOK_PAGE_MODULE: "true",
      META_PAGE_ACCESS_TOKEN: "C".repeat(40),
      META_PAGE_ID: "111",
    };
    const config = loadConfig(env as NodeJS.ProcessEnv);
    expect(secretsOf(config)).toContain("C".repeat(40));
  });
});
